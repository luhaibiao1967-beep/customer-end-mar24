// src/Pages/PlaceOrder.tsx - Add New Delivery Order
import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import BottomNav from '../Components/BottomNav';
import { theme } from '../theme';
import { formatCurrency } from '../utils/format';
import toast from 'react-hot-toast';

interface Customer {
  id: string;
  name: string;
  address: string;
  whatsapp: string;
  customer_type: string;
  payment_term?: string;
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

function getJakartaDateString(date: Date = new Date()): string {
  return date.toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' }); // returns YYYY-MM-DD
}

function getDefaultDeliveryDate(): string {
  const now = new Date();
  const hour = parseInt(now.toLocaleString('en-US', { timeZone: 'Asia/Jakarta', hour: 'numeric', hour12: false }), 10);
  const date = hour >= 15 ? new Date(now.getTime() + 86400000) : now;
  return getJakartaDateString(date);
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

  // Fresh customer data
  const [freshDiscount, setFreshDiscount] = useState<number>(customer.discount || 0);

  // Unpaid orders block (daily later_pay)
  const [blockedByUnpaid, setBlockedByUnpaid] = useState(false);
  const [showUnpaidModal, setShowUnpaidModal] = useState(false);

  // Per-product voucher balances: productId → balance
  const [productVouchers, setProductVouchers] = useState<Map<string, number>>(new Map());

  const isPrePay = customer.customer_type === 'pre_pay';

  const getUnitPrice = (product: Product): number => {
    if (isPrePay) return product.price;
    if (product.is_refill) return Math.max(0, REFILL_BASE_PRICE - freshDiscount);
    return product.price;
  };

  const loadSnapScript = (clientKey: string, snapJsUrl: string): Promise<void> =>
    new Promise((resolve, reject) => {
      if ((window as any).snap) { resolve(); return; }
      const existing = document.querySelector('script[data-midtrans-snap]');
      if (existing) {
        if ((window as any).snap) { resolve(); return; }
        existing.addEventListener('load', () => resolve());
        existing.addEventListener('error', reject);
        return;
      }
      const script = document.createElement('script');
      script.src = snapJsUrl;
      script.setAttribute('data-client-key', clientKey);
      script.setAttribute('data-midtrans-snap', 'true');
      script.onload = () => resolve();
      script.onerror = reject;
      document.body.appendChild(script);
    });

  const cartItems: CartItem[] = products
    .filter(p => (cart.get(p.id) || 0) > 0)
    .map(p => ({ product: p, quantity: cart.get(p.id)! }));

  const totalAmount = cartItems.reduce((sum, item) =>
    sum + getUnitPrice(item.product) * item.quantity, 0);

  // For pre_pay: check each product independently against its voucher balance
  const insufficientProducts = isPrePay
    ? cartItems.filter(item => item.quantity > (productVouchers.get(item.product.id) ?? 0))
    : [];
  const hasEnoughVouchers = insufficientProducts.length === 0;

  useEffect(() => {
    loadProducts();
    fetchFreshCustomerData();
    checkUnpaidBlock();
  }, []);

  const checkUnpaidBlock = async () => {
    if (customer.customer_type === 'pre_pay' || editOrderId) return;
    try {
      // Fetch payment_term from DB (may not be in sessionStorage for older sessions)
      const { data: cust } = await supabase
        .from('customers')
        .select('payment_term')
        .eq('id', customer.id)
        .single();
      if (cust?.payment_term !== 'daily') return;

      const token = sessionStorage.getItem('auth_token');
      if (!token) return;

      const { data } = await supabase.functions.invoke('get-orders', { body: { token } });
      if (data?.success) {
        const hasUnpaid = (data.orders || []).some(
          (o: any) => o.payment_status === 'unpaid' && o.status === 'delivered'
        );
        if (hasUnpaid) setBlockedByUnpaid(true);
      }
    } catch {
      // silently fail — don't block ordering on network error
    }
  };

  const fetchFreshCustomerData = async () => {
    try {
      const { data } = await supabase
        .from('customers')
        .select('discount')
        .eq('id', customer.id)
        .single();
      if (data) setFreshDiscount(data.discount || 0);
    } catch {
      // silently fall back
    }
  };

  const fetchProductVouchers = async () => {
    if (!isPrePay) return;
    try {
      const { data } = await supabase
        .from('customer_product_vouchers')
        .select('product_id, balance')
        .eq('customer_id', customer.id);

      const map = new Map<string, number>();
      for (const row of data || []) {
        map.set(row.product_id, row.balance);
      }
      setProductVouchers(map);
    } catch {
      // silently fall back — no vouchers = empty map
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
    return 2;
  };

  const loadProducts = async () => {
    try {
      const { data, error } = await supabase
        .from('products')
        .select('*')
        .eq('status', 'active');
      if (error) throw error;

      const filtered = (data || []).filter(p => {
        const lower = p.name.toLowerCase();
        return !lower.includes('empty') && !lower.includes('sample');
      });

      filtered.sort((a, b) =>
        getProductSortOrder(a.name, a.is_refill) - getProductSortOrder(b.name, b.is_refill)
      );

      setProducts(filtered);
    } catch (err: any) {
      setError('Failed to load products: ' + err.message);
    } finally {
      setLoading(false);
      // Fetch vouchers after products loaded
      fetchProductVouchers();
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
        if (matched) newCart.set(matched.id, item.quantity);
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
      setError('Please select at least one product.');
      return;
    }
    if (!deliveryDate) {
      setError('Please select a delivery date.');
      return;
    }
    if (isPrePay && !hasEnoughVouchers) {
      setError('Insufficient vouchers for some products. Please buy more.');
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

      // Build per-product deductions for pre_pay
      const product_deductions = isPrePay
        ? cartItems.map(item => ({
            product_id: item.product.id,
            quantity: item.quantity,
          }))
        : [];

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
          product_deductions,
          edit_order_id: editOrderId || undefined,
        },
      });

      if (error) throw new Error(error.message);
      if (!data?.success) {
        if (data?.error === 'UNPAID_ORDERS') {
          setError('UNPAID_ORDERS');
          return;
        }
        throw new Error(data?.error || 'Unknown error');
      }

      // Refresh local voucher map optimistically
      if (isPrePay && !editOrderId) {
        setProductVouchers(prev => {
          const next = new Map(prev);
          for (const item of cartItems) {
            const old = next.get(item.product.id) ?? 0;
            next.set(item.product.id, Math.max(0, old - item.quantity));
          }
          return next;
        });
      }

      setShowSuccess(true);
    } catch (err: any) {
      setError('Failed to submit: ' + err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handlePayWithQris = async () => {
    if (cartItems.length === 0) { setError('Please select at least one product.'); return; }
    if (!deliveryDate) { setError('Please select a delivery date.'); return; }

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
        discount: 0,
      }));

      const { data, error } = await supabase.functions.invoke('submit-prepay-order', {
        body: {
          token,
          order: { delivery_date: deliveryDate, note: notes || null, total_amount: totalAmount },
          items: orderItems,
        },
      });

      if (error) throw new Error(error.message);
      if (!data?.success) throw new Error(data?.error || 'Failed to create payment');

      await loadSnapScript(data.client_key, data.snap_js_url);

      let paymentCompleted = false;
      (window as any).snap.pay(data.snap_token, {
        onSuccess: () => {
          paymentCompleted = true;
          setSubmitting(false);
          setShowSuccess(true);
        },
        onPending: () => {
          paymentCompleted = true;
          setSubmitting(false);
          toast('Payment submitted — order will be confirmed once payment settles.', { duration: 6000 });
          navigate('/customer-home');
        },
        onError: (result: any) => {
          paymentCompleted = true;
          setSubmitting(false);
          setError('Payment failed: ' + (result?.status_message || 'Unknown error'));
        },
        onClose: () => {
          setSubmitting(false);
          if (!paymentCompleted) {
            toast('Payment not completed. Your order is saved — you can pay from Order History.', { duration: 6000 });
            navigate('/orders');
          }
        },
      });
    } catch (err: any) {
      setSubmitting(false);
      setError('Failed to submit: ' + err.message);
    }
  };

  const today = getJakartaDateString();

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

        {/* Unpaid orders block — daily later_pay */}
        {blockedByUnpaid && (
          <div style={{ background: '#fdecea', border: `2px solid ${theme.error}`, borderRadius: '16px', padding: '20px' }}>
            <p style={{ margin: '0 0 8px 0', fontWeight: '700', color: theme.error, fontSize: '16px' }}>🚫 Outstanding Balance</p>
            <p style={{ margin: '0 0 16px 0', fontSize: '14px', color: theme.error }}>
              You have unpaid delivered orders. Please settle your balance before placing a new order.
            </p>
            <button
              onClick={() => navigate('/orders')}
              style={{ padding: '12px 24px', background: theme.gradientPrimary, color: 'white', border: 'none', borderRadius: '8px', fontSize: '14px', fontWeight: 'bold', cursor: 'pointer' }}
            >
              💳 View &amp; Pay Bills
            </button>
          </div>
        )}

        {/* Voucher summary banner (pre_pay only) */}
        {isPrePay && productVouchers.size > 0 && (
          <div style={{ background: 'white', borderRadius: '16px', padding: '16px 20px', boxShadow: '0 4px 20px rgba(0,0,0,0.15)' }}>
            <p style={{ fontSize: '13px', fontWeight: '600', color: theme.textMuted, margin: '0 0 10px 0' }}>🎫 Voucher Balance</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {products
                .filter(p => productVouchers.has(p.id))
                .map(p => (
                  <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}>
                    <span style={{ color: theme.text }}>{p.name}</span>
                    <span style={{ fontWeight: 'bold', color: (productVouchers.get(p.id) ?? 0) > 0 ? theme.primary : theme.error }}>
                      {productVouchers.get(p.id) ?? 0}
                    </span>
                  </div>
                ))}
            </div>
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
                const voucherBalance = productVouchers.get(product.id);
                const plusDisabled = false;

                return (
                  <div key={product.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px', background: qty > 0 ? '#f0fbfb' : theme.cardBgAlt, borderRadius: '10px', border: `2px solid ${qty > 0 ? theme.primary : 'transparent'}` }}>
                    <div style={{ flex: 1 }}>
                      <p style={{ margin: 0, fontWeight: '600', fontSize: '14px', color: theme.text }}>{product.name}</p>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '2px', flexWrap: 'wrap' }}>
                        <span style={{ fontSize: '13px', color: theme.textMuted }}>
                          {formatCurrency(unitPrice)} / {product.unit}
                          {!isPrePay && product.is_refill && freshDiscount > 0 && (
                            <span style={{ marginLeft: '6px', color: theme.success, fontSize: '11px' }}>
                              (disc. {formatCurrency(freshDiscount)})
                            </span>
                          )}
                        </span>
                        {/* Voucher badge + Buy button for pre_pay — always show, even if 0 */}
                        {isPrePay && (
                          <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <span style={{
                              fontSize: '11px',
                              fontWeight: '600',
                              color: (voucherBalance ?? 0) > 0 ? theme.primary : theme.error,
                              background: (voucherBalance ?? 0) > 0 ? '#f0fbfb' : '#fdecea',
                              padding: '2px 8px',
                              borderRadius: '12px',
                              border: `1px solid ${(voucherBalance ?? 0) > 0 ? theme.primary : theme.error}`,
                            }}>
                              🎫 {voucherBalance ?? 0}
                            </span>
                            <button
                              onClick={() => navigate('/buy-vouchers')}
                              style={{ fontSize: '11px', fontWeight: '600', color: 'white', background: theme.gradientSuccess, border: 'none', borderRadius: '10px', padding: '2px 8px', cursor: 'pointer' }}
                            >
                              Buy
                            </button>
                          </span>
                        )}
                      </div>
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
                        disabled={plusDisabled}
                        style={{ width: '32px', height: '32px', borderRadius: '50%', border: 'none', background: plusDisabled ? '#ddd' : theme.primary, color: 'white', fontSize: '18px', fontWeight: 'bold', cursor: plusDisabled ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
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
          </div>
        )}

        {/* Voucher insufficient warning (pre_pay) */}
        {isPrePay && insufficientProducts.length > 0 && (
          <div style={{ background: '#fff3cd', border: `2px solid ${theme.warning}`, borderRadius: '16px', padding: '20px' }}>
            <p style={{ margin: '0 0 8px 0', fontWeight: '600', color: '#856404' }}>
              ⚠️ Voucher tidak cukup untuk:
            </p>
            {insufficientProducts.map(item => (
              <p key={item.product.id} style={{ margin: '2px 0', fontSize: '13px', color: '#856404' }}>
                • {item.product.name}: butuh {item.quantity}, tersedia {productVouchers.get(item.product.id) ?? 0}
              </p>
            ))}
            <button
              onClick={() => navigate('/buy-vouchers')}
              style={{ marginTop: '12px', padding: '10px 24px', background: theme.gradientSuccess, color: 'white', border: 'none', borderRadius: '8px', fontSize: '14px', fontWeight: 'bold', cursor: 'pointer' }}
            >
              🎫 Beli Voucher
            </button>
          </div>
        )}

        {/* Unpaid orders block */}
        {error === 'UNPAID_ORDERS' && (
          <div style={{ background: '#fdecea', border: `2px solid ${theme.error}`, borderRadius: '12px', padding: '16px' }}>
            <p style={{ margin: '0 0 8px 0', fontWeight: '700', color: theme.error, fontSize: '14px' }}>
              🚫 Tagihan Belum Dibayar
            </p>
            <p style={{ margin: '0 0 12px 0', fontSize: '13px', color: theme.error }}>
              Anda memiliki tagihan yang belum dilunasi. Mohon selesaikan pembayaran terlebih dahulu sebelum membuat pesanan baru.
            </p>
            <button
              onClick={() => navigate('/orders')}
              style={{ padding: '10px 20px', background: theme.gradientPrimary, color: 'white', border: 'none', borderRadius: '8px', fontSize: '14px', fontWeight: 'bold', cursor: 'pointer' }}
            >
              💳 Lihat &amp; Bayar Tagihan
            </button>
          </div>
        )}

        {/* Error */}
        {error && error !== 'UNPAID_ORDERS' && (
          <div style={{ background: '#fdecea', border: `2px solid ${theme.error}`, borderRadius: '12px', padding: '14px 16px', color: theme.error, fontSize: '14px' }}>
            ⚠️ {error}
          </div>
        )}

        {/* Submit */}
        {isPrePay && !hasEnoughVouchers && cartItems.length > 0 ? (
          <button
            onClick={handlePayWithQris}
            disabled={submitting || !deliveryDate}
            style={{
              width: '100%', padding: '16px',
              background: (submitting || !deliveryDate) ? '#ccc' : theme.gradientPrimary,
              color: 'white', border: 'none', borderRadius: '12px', fontSize: '16px', fontWeight: 'bold',
              cursor: (submitting || !deliveryDate) ? 'not-allowed' : 'pointer',
            }}
          >
            {submitting ? 'Processing...' : 'Pay via QRIS'}
          </button>
        ) : (
          <button
            onClick={() => blockedByUnpaid ? setShowUnpaidModal(true) : handleSubmit()}
            disabled={submitting || cartItems.length === 0}
            style={{
              width: '100%', padding: '16px',
              background: (submitting || cartItems.length === 0) ? '#ccc' : theme.gradientPrimary,
              color: 'white', border: 'none', borderRadius: '12px', fontSize: '16px', fontWeight: 'bold',
              cursor: (submitting || cartItems.length === 0) ? 'not-allowed' : 'pointer',
            }}
          >
            {submitting ? 'Submitting...' : editOrderId ? '✅ Update Order' : '✅ Place Order'}
          </button>
        )}
      </div>

      <BottomNav customer={customer} />

      {/* Unpaid Orders Modal */}
      {showUnpaidModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 3000, padding: '20px' }}>
          <div style={{ background: 'white', borderRadius: '20px', padding: '28px 24px', maxWidth: '360px', width: '100%', textAlign: 'center', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}>
            <p style={{ fontSize: '48px', margin: '0 0 12px 0' }}>⚠️</p>
            <h3 style={{ fontSize: '18px', fontWeight: '700', color: theme.error, margin: '0 0 12px 0' }}>Outstanding Balance</h3>
            <p style={{ fontSize: '14px', color: '#555', margin: '0 0 24px 0', lineHeight: '1.5' }}>
              You have unpaid delivered orders.<br />
              Please settle your balance first before placing a new order.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <button
                onClick={() => { setShowUnpaidModal(false); navigate('/orders'); }}
                style={{ width: '100%', padding: '13px', background: theme.gradientPrimary, color: 'white', border: 'none', borderRadius: '10px', fontSize: '15px', fontWeight: 'bold', cursor: 'pointer' }}
              >
                💳 View &amp; Pay Bills
              </button>
              <button
                onClick={() => setShowUnpaidModal(false)}
                style={{ width: '100%', padding: '11px', background: 'none', color: theme.textMuted, border: `2px solid #ddd`, borderRadius: '10px', fontSize: '14px', cursor: 'pointer' }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
