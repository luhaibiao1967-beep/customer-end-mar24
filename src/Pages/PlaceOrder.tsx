// src/Pages/PlaceOrder.tsx - Add New Delivery Order
import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import BottomNav from '../Components/BottomNav';
import { theme } from '../theme';

interface Customer {
  id: string;
  name: string;
  address: string;
  whatsapp: string;
  customer_type: string;
  voucher_balance: number;
  branch: string;
  discount: number;
}

interface Product {
  id: string;
  name: string;
  price: number;
  unit: string;
  is_refill: boolean;
  status: string;
}

interface CartItem {
  product: Product;
  quantity: number;
}

interface PlaceOrderProps {
  customer: Customer;
}

// Base price for refill gallon — update here if price changes
const REFILL_BASE_PRICE = 15000;

function getDefaultDeliveryDate(): string {
  const now = new Date();
  const hour = now.getHours();
  const date = hour >= 15 ? new Date(now.getTime() + 86400000) : now;
  return date.toISOString().split('T')[0];
}

export default function PlaceOrder({ customer }: PlaceOrderProps) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const editOrderId = searchParams.get('edit');

  const [products, setProducts] = useState<Product[]>([]);
  const [cart, setCart] = useState<Map<string, number>>(new Map());
  const [deliveryDate, setDeliveryDate] = useState(getDefaultDeliveryDate());
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [showSuccess, setShowSuccess] = useState(false);
  // Fresh customer data fetched from DB (discount may have changed since login)
  const [freshDiscount, setFreshDiscount] = useState<number>(customer.discount || 0);
  const [freshVoucherBalance, setFreshVoucherBalance] = useState<number>(customer.voucher_balance || 0);

  const isPrePay = customer.customer_type === 'pre_pay';

  // For later_pay customers: refill = REFILL_BASE_PRICE - discount; others use product.price
  const getUnitPrice = (product: Product): number => {
    if (isPrePay) return product.price;
    if (product.is_refill) return Math.max(0, REFILL_BASE_PRICE - freshDiscount);
    return product.price;
  };

  // Calculate totals
  const cartItems: CartItem[] = products
    .filter(p => (cart.get(p.id) || 0) > 0)
    .map(p => ({ product: p, quantity: cart.get(p.id)! }));

  const totalAmount = cartItems.reduce((sum, item) => {
    return sum + getUnitPrice(item.product) * item.quantity;
  }, 0);

  // For pre_pay: vouchers needed = total quantity of items
  const vouchersNeeded = cartItems.reduce((sum, item) => sum + item.quantity, 0);
  const hasEnoughVouchers = freshVoucherBalance >= vouchersNeeded;

  useEffect(() => {
    loadProducts();
    fetchFreshCustomerData();
  }, []);

  const fetchFreshCustomerData = async () => {
    try {
      const { data, error } = await supabase
        .from('customers')
        .select('discount, voucher_balance')
        .eq('id', customer.id)
        .single();
      if (error || !data) return;
      setFreshDiscount(data.discount || 0);
      setFreshVoucherBalance(data.voucher_balance || 0);
      // Also update sessionStorage so other pages stay in sync
      const stored = sessionStorage.getItem('customer');
      if (stored) {
        const parsed = JSON.parse(stored);
        parsed.discount = data.discount || 0;
        parsed.voucher_balance = data.voucher_balance || 0;
        sessionStorage.setItem('customer', JSON.stringify(parsed));
      }
    } catch {
      // silently fail — fall back to sessionStorage values
    }
  };

  useEffect(() => {
    if (editOrderId && products.length > 0) {
      loadEditOrder(editOrderId);
    }
  }, [editOrderId, products]);

  // Sort: refill first → new gallon second → accessories last
  const getProductSortOrder = (name: string, is_refill: boolean): number => {
    const lower = name.toLowerCase();
    if (is_refill || lower.includes('refill')) return 0;
    if ((lower.includes('gallon') || lower.includes('galon')) && !lower.includes('rack')) return 1;
    return 2; // accessories: pump, rack, etc.
  };

  const loadProducts = async () => {
    try {
      const { data, error } = await supabase
        .from('products')
        .select('*')
        .eq('status', 'active');
      if (error) throw error;

      // Filter out sales-only products (empty gallon collection, sample)
      const filtered = (data || []).filter(p => {
        const lower = p.name.toLowerCase();
        return !lower.includes('empty') && !lower.includes('sample');
      });

      // Sort by frequency: refill → new gallon → accessories
      filtered.sort((a, b) =>
        getProductSortOrder(a.name, a.is_refill) - getProductSortOrder(b.name, b.is_refill)
      );

      setProducts(filtered);
    } catch (err: any) {
      setError('Failed to load products: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const loadEditOrder = async (orderId: string) => {
    try {
      const token = sessionStorage.getItem('auth_token');
      if (!token) throw new Error('Session expired');

      const { data, error } = await supabase.functions.invoke('get-orders', {
        body: { token, order_id: orderId },
      });

      if (error) throw new Error(error.message);
      if (!data?.success) throw new Error(data?.error || 'Failed to load order');

      const order = data.order;
      setDeliveryDate(order.delivery_date);
      setNotes(order.delivery_notes || '');

      const newCart = new Map<string, number>();
      for (const item of order.order_items || []) {
        const matched = products.find(p => p.name === item.product);
        if (matched) {
          newCart.set(matched.id, item.quantity);
        }
      }
      setCart(newCart);
    } catch (err: any) {
      setError('Failed to load order: ' + err.message);
    }
  };

  const updateCart = (productId: string, delta: number) => {
    setCart(prev => {
      const next = new Map(prev);
      const current = next.get(productId) || 0;
      const newVal = Math.max(0, current + delta);
      if (newVal === 0) {
        next.delete(productId);
      } else {
        next.set(productId, newVal);
      }
      return next;
    });
  };

  const handleSubmit = async () => {
    if (cartItems.length === 0) {
      setError('请至少选择一件商品。');
      return;
    }
    if (!deliveryDate) {
      setError('请选择配送日期。');
      return;
    }
    if (isPrePay && !hasEnoughVouchers) {
      setError('Voucher 余额不足，请先购买。');
      return;
    }

    setSubmitting(true);
    setError('');

    try {
      const token = sessionStorage.getItem('auth_token');
      if (!token) throw new Error('Session expired, please login again');

      const orderItems = cartItems.map(item => ({
        product: item.product.name,
        is_refill: item.product.is_refill,
        quantity: item.quantity,
        unit_price: getUnitPrice(item.product),
        discount: item.product.is_refill ? (freshDiscount || 0) : 0,
      }));

      const { data, error } = await supabase.functions.invoke('submit-order', {
        body: {
          token,
          order: {
            delivery_date: deliveryDate,
            note: notes || null,
            total_amount: totalAmount,
            payment_status: isPrePay ? 'paid' : 'unpaid',
          },
          items: orderItems,
          vouchers_to_deduct: isPrePay ? vouchersNeeded : 0,
          edit_order_id: editOrderId || undefined,
        },
      });

      if (error) throw new Error(error.message);
      if (!data?.success) throw new Error(data?.error || 'Unknown error');

      // Update session storage voucher balance if deducted
      if (isPrePay && !editOrderId) {
        const stored = sessionStorage.getItem('customer');
        if (stored) {
          const parsed = JSON.parse(stored);
          parsed.voucher_balance = freshVoucherBalance - vouchersNeeded;
          sessionStorage.setItem('customer', JSON.stringify(parsed));
        }
      }

      setShowSuccess(true);
    } catch (err: any) {
      setError('提交失败：' + err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const formatCurrency = (amount: number) =>
    new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(amount);

  const today = new Date().toISOString().split('T')[0];

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', background: theme.gradientPrimary, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center', color: 'white' }}>
          <div style={{ width: '40px', height: '40px', border: '4px solid rgba(255,255,255,0.3)', borderTop: '4px solid white', borderRadius: '50%', margin: '0 auto 16px', animation: 'spin 1s linear infinite' }} />
          <p>Loading products...</p>
          <style>{`@keyframes spin { 0%{transform:rotate(0deg)} 100%{transform:rotate(360deg)} }`}</style>
        </div>
      </div>
    );
  }

  if (showSuccess) {
    return (
      <div style={{ minHeight: '100vh', background: theme.gradientPrimary, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
        <div style={{ background: 'white', borderRadius: '20px', padding: '40px', maxWidth: '400px', width: '100%', textAlign: 'center', boxShadow: '0 10px 40px rgba(0,0,0,0.2)' }}>
          <div style={{ fontSize: '64px', marginBottom: '16px' }}>✅</div>
          <h2 style={{ fontSize: '22px', color: theme.text, margin: '0 0 10px 0' }}>
            {editOrderId ? 'Order Updated!' : 'Order Placed!'}
          </h2>
          <p style={{ color: theme.textMuted, fontSize: '14px', margin: '0 0 24px 0' }}>
            {editOrderId
              ? 'Your order has been updated successfully.'
              : 'Your order has been received. We will arrange delivery soon.'}
          </p>
          <button
            onClick={() => navigate('/customer-home')}
            style={{ width: '100%', padding: '14px', background: theme.gradientPrimary, color: 'white', border: 'none', borderRadius: '10px', fontSize: '16px', fontWeight: 'bold', cursor: 'pointer' }}
          >
            Back to Home
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: theme.gradientPrimary, padding: '20px', paddingBottom: '100px' }}>

      {/* Header */}
      <div style={{ maxWidth: '800px', margin: '0 auto 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <button
          onClick={() => navigate('/customer-home')}
          style={{ padding: '10px 20px', background: 'rgba(255,255,255,0.2)', color: 'white', border: '2px solid white', borderRadius: '8px', fontSize: '14px', fontWeight: 'bold', cursor: 'pointer' }}
        >
          ← Back
        </button>
        <h1 style={{ color: 'white', fontSize: '20px', margin: 0 }}>
          {editOrderId ? '✏️ Edit Order' : '🛒 New Delivery'}
        </h1>
        <div style={{ width: '80px' }} />
      </div>

      <div style={{ maxWidth: '800px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '16px' }}>

        {/* Voucher balance (pre_pay only) */}
        {isPrePay && (
          <div style={{ background: 'white', borderRadius: '16px', padding: '16px 20px', boxShadow: '0 4px 20px rgba(0,0,0,0.15)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '14px', color: theme.textMuted }}>🎫 Voucher Balance</span>
            <span style={{ fontSize: '20px', fontWeight: 'bold', color: theme.primary }}>{freshVoucherBalance}</span>
          </div>
        )}

        {/* Delivery Date */}
        <div style={{ background: 'white', borderRadius: '16px', padding: '20px', boxShadow: '0 4px 20px rgba(0,0,0,0.15)' }}>
          <label style={{ fontSize: '14px', fontWeight: '600', color: theme.text, display: 'block', marginBottom: '10px' }}>
            📅 Delivery Date
          </label>
          <input
            type="date"
            value={deliveryDate}
            min={today}
            onChange={e => setDeliveryDate(e.target.value)}
            style={{ width: '100%', padding: '12px', fontSize: '16px', border: `2px solid ${theme.primary}`, borderRadius: '8px', outline: 'none', boxSizing: 'border-box' }}
          />
        </div>

        {/* Products */}
        <div style={{ background: 'white', borderRadius: '16px', padding: '20px', boxShadow: '0 4px 20px rgba(0,0,0,0.15)' }}>
          <p style={{ fontSize: '14px', fontWeight: '600', color: theme.text, margin: '0 0 16px 0' }}>🛍️ Select Products</p>
          {products.length === 0 ? (
            <p style={{ color: theme.textMuted, textAlign: 'center', padding: '20px 0' }}>No products available.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {products.map(product => {
                const qty = cart.get(product.id) || 0;
                const unitPrice = getUnitPrice(product);
                return (
                  <div key={product.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px', background: qty > 0 ? '#f0fbfb' : theme.cardBgAlt, borderRadius: '10px', border: `2px solid ${qty > 0 ? theme.primary : 'transparent'}` }}>
                    <div style={{ flex: 1 }}>
                      <p style={{ margin: 0, fontWeight: '600', fontSize: '14px', color: theme.text }}>{product.name}</p>
                      <p style={{ margin: '2px 0 0', fontSize: '13px', color: theme.textMuted }}>
                        {formatCurrency(unitPrice)} / {product.unit}
                        {!isPrePay && product.is_refill && freshDiscount > 0 && <span style={{ marginLeft: '6px', color: theme.success, fontSize: '11px' }}>(disc. {formatCurrency(freshDiscount)})</span>}
                      </p>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <button
                        onClick={() => updateCart(product.id, -1)}
                        disabled={qty === 0}
                        style={{ width: '32px', height: '32px', borderRadius: '50%', border: 'none', background: qty > 0 ? theme.primary : '#ddd', color: 'white', fontSize: '18px', fontWeight: 'bold', cursor: qty > 0 ? 'pointer' : 'not-allowed', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                      >
                        −
                      </button>
                      <span style={{ width: '28px', textAlign: 'center', fontWeight: 'bold', fontSize: '16px' }}>{qty}</span>
                      <button
                        onClick={() => updateCart(product.id, 1)}
                        style={{ width: '32px', height: '32px', borderRadius: '50%', border: 'none', background: theme.primary, color: 'white', fontSize: '18px', fontWeight: 'bold', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                      >
                        +
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Notes */}
        <div style={{ background: 'white', borderRadius: '16px', padding: '20px', boxShadow: '0 4px 20px rgba(0,0,0,0.15)' }}>
          <label style={{ fontSize: '14px', fontWeight: '600', color: theme.text, display: 'block', marginBottom: '10px' }}>
            📝 Notes (Optional)
          </label>
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="E.g. Please leave at the door..."
            rows={3}
            style={{ width: '100%', padding: '12px', fontSize: '14px', border: `2px solid #eee`, borderRadius: '8px', outline: 'none', resize: 'vertical', fontFamily: 'inherit', boxSizing: 'border-box' }}
          />
        </div>

        {/* Order Summary */}
        {cartItems.length > 0 && (
          <div style={{ background: 'white', borderRadius: '16px', padding: '20px', boxShadow: '0 4px 20px rgba(0,0,0,0.15)' }}>
            <p style={{ fontSize: '14px', fontWeight: '600', color: theme.text, margin: '0 0 12px 0' }}>📋 Order Summary</p>
            {cartItems.map(item => (
              <div key={item.product.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', color: theme.textMuted, marginBottom: '6px' }}>
                <span>{item.product.name} × {item.quantity}</span>
                <span>{formatCurrency(getUnitPrice(item.product) * item.quantity)}</span>
              </div>
            ))}
            <div style={{ borderTop: '1px solid #eee', marginTop: '10px', paddingTop: '10px', display: 'flex', justifyContent: 'space-between', fontWeight: 'bold', fontSize: '16px' }}>
              <span>Total</span>
              <span style={{ color: theme.primary }}>{formatCurrency(totalAmount)}</span>
            </div>
            {isPrePay && (
              <div style={{ marginTop: '10px', fontSize: '13px', color: theme.textMuted }}>
                Vouchers needed: <strong>{vouchersNeeded}</strong> &nbsp;|&nbsp; Balance: <strong>{freshVoucherBalance}</strong>
              </div>
            )}
          </div>
        )}

        {/* Voucher insufficient warning */}
        {isPrePay && cartItems.length > 0 && !hasEnoughVouchers && (
          <div style={{ background: '#fff3cd', border: `2px solid ${theme.warning}`, borderRadius: '16px', padding: '20px', textAlign: 'center' }}>
            <p style={{ margin: '0 0 12px 0', fontWeight: '600', color: '#856404' }}>
              ⚠️ Voucher 不足！需要 {vouchersNeeded} 张，当前只有 {freshVoucherBalance} 张。
            </p>
            <button
              onClick={() => navigate('/buy-vouchers')}
              style={{ padding: '10px 24px', background: theme.gradientSuccess, color: 'white', border: 'none', borderRadius: '8px', fontSize: '14px', fontWeight: 'bold', cursor: 'pointer' }}
            >
              🎫 去购买 Voucher
            </button>
          </div>
        )}

        {/* Error */}
        {error && (
          <div style={{ background: '#fdecea', border: `2px solid ${theme.error}`, borderRadius: '12px', padding: '14px 16px', color: theme.error, fontSize: '14px' }}>
            ⚠️ {error}
          </div>
        )}

        {/* Submit */}
        <button
          onClick={handleSubmit}
          disabled={submitting || cartItems.length === 0 || (isPrePay && !hasEnoughVouchers)}
          style={{
            width: '100%',
            padding: '16px',
            background: (submitting || cartItems.length === 0 || (isPrePay && !hasEnoughVouchers)) ? '#ccc' : theme.gradientPrimary,
            color: 'white',
            border: 'none',
            borderRadius: '12px',
            fontSize: '16px',
            fontWeight: 'bold',
            cursor: (submitting || cartItems.length === 0 || (isPrePay && !hasEnoughVouchers)) ? 'not-allowed' : 'pointer',
          }}
        >
          {submitting ? '提交中...' : editOrderId ? '✅ 更新订单' : '✅ 提交订单'}
        </button>
      </div>

      <BottomNav customer={customer} />
    </div>
  );
}
