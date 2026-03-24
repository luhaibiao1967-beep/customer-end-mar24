// src/Pages/PlaceOrder.tsx - Add New Delivery Order
import { useState, useEffect, Fragment } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import BottomNavV0 from '../Components/BottomNavV0';
import { theme } from '../theme';
import { formatCurrency } from '../utils/format';
import toast from 'react-hot-toast';
import { useLanguage } from '../contexts/LanguageContext';
import { useColorTokens } from '../contexts/ColorTokensContext';

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

const isAccessory = (p: Product) => {
  const lower = p.name.toLowerCase();
  return lower.includes('pump') || lower.includes('rack');
};

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
  const { t } = useLanguage();
  const { tokens, isDark } = useColorTokens();
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

  // Credit limit (later_pay)
  const [creditLimit, setCreditLimit] = useState<number | null>(null);
  const [unpaidCredit, setUnpaidCredit] = useState<number>(0);

  // Per-product voucher balances: productId → balance
  const [productVouchers, setProductVouchers] = useState<Map<string, number>>(new Map());

  // Accessories section collapsed by default
  const [showAccessories, setShowAccessories] = useState(false);

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

  // Per-product breakdown of voucher coverage vs remaining (QRIS for pre_pay / credit for later_pay)
  const voucherBreakdown = cartItems.map(item => {
    const available = productVouchers.get(item.product.id) ?? 0;
    const byVoucher = Math.min(item.quantity, available);
    const byPayment = item.quantity - byVoucher;
    return { item, byVoucher, byPayment };
  });
  const payableAmount = voucherBreakdown.reduce(
    (sum, { item, byPayment }) => sum + byPayment * getUnitPrice(item.product), 0
  );
  const hasEnoughVouchers = isPrePay ? payableAmount === 0 : true;

  useEffect(() => {
    loadProducts();
    fetchFreshCustomerData();
    checkUnpaidBlock();
    fetchUnpaidCredit();
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
        .select('discount, credit_limit')
        .eq('id', customer.id)
        .single();
      if (data) {
        setFreshDiscount(data.discount || 0);
        setCreditLimit(data.credit_limit ?? null);
      }
    } catch {
      // silently fall back
    }
  };

  const fetchUnpaidCredit = async () => {
    if (isPrePay) return;
    try {
      const { data } = await supabase
        .from('orders')
        .select('total_amount')
        .eq('customer_id', customer.id)
        .eq('payment_status', 'unpaid');
      const sum = (data || []).reduce((s: number, o: any) => s + (o.total_amount || 0), 0);
      setUnpaidCredit(sum);
    } catch {
      // silently fail
    }
  };

  const fetchProductVouchers = async () => {
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
        return !lower.includes('empty') && !lower.includes('sample')
          && !(lower.includes('test') && customer.branch !== 'Demo');
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

      // Credit limit check for later_pay (frontend guard)
      if (!isPrePay && !editOrderId && creditLimit !== null) {
        if (unpaidCredit + payableAmount > creditLimit) {
          setError('CREDIT_LIMIT_EXCEEDED');
          setSubmitting(false);
          return;
        }
      }

      // Build per-product voucher deductions (all customer types)
      const product_deductions = voucherBreakdown
        .filter(({ byVoucher }) => byVoucher > 0)
        .map(({ item, byVoucher }) => ({ product_id: item.product.id, quantity: byVoucher }));

      const { data, error } = await supabase.functions.invoke('submit-order', {
        body: {
          token,
          order: {
            delivery_date: deliveryDate,
            note: notes || null,
            total_amount: totalAmount,
            payment_status: payableAmount === 0 ? 'paid' : 'unpaid',
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
        if (data?.error === 'CREDIT_LIMIT_EXCEEDED') {
          setError('CREDIT_LIMIT_EXCEEDED');
          return;
        }
        throw new Error(data?.error || 'Unknown error');
      }

      // Refresh local voucher map optimistically
      if (!editOrderId) {
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

      const product_deductions = voucherBreakdown
        .filter(({ byVoucher }) => byVoucher > 0)
        .map(({ item, byVoucher }) => ({ product_id: item.product.id, quantity: byVoucher }));

      const { data, error } = await supabase.functions.invoke('submit-prepay-order', {
        body: {
          token,
          order: { delivery_date: deliveryDate, note: notes || null, total_amount: totalAmount },
          items: orderItems,
          payment_amount: payableAmount,
          product_deductions,
        },
      });

      if (error) throw new Error(error.message);
      if (!data?.success) throw new Error(data?.error || 'Failed to create payment');

      await loadSnapScript(data.client_key, data.snap_js_url);

      const midtransOrderId = data.midtrans_order_id;
      let paymentCompleted = false;
      (window as any).snap.pay(data.snap_token, {
        onSuccess: async () => {
          paymentCompleted = true;
          try {
            await supabase.functions.invoke('confirm-snap-payment', {
              body: { token, midtrans_order_id: midtransOrderId },
            });
          } catch (_) { /* webhook will handle it as fallback */ }
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
      <div style={{ minHeight: '100vh', background: tokens.pageBg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center', color: tokens.text }}>
          <div style={{ width: '40px', height: '40px', border: `4px solid ${tokens.primaryBorder}`, borderTop: `4px solid ${tokens.primary}`, borderRadius: '50%', margin: '0 auto 16px', animation: 'spin 1s linear infinite' }} />
          <p>{t('placeOrder.loadingProducts')}</p>
          <style>{`@keyframes spin { 0%{transform:rotate(0deg)} 100%{transform:rotate(360deg)} }`}</style>
        </div>
      </div>
    );
  }

  if (showSuccess) {
    return (
      <div style={{ minHeight: '100vh', background: tokens.pageBg, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
        <div style={{ background: tokens.card, borderRadius: '20px', padding: '40px', maxWidth: '400px', width: '100%', textAlign: 'center', boxShadow: '0 10px 40px rgba(0,0,0,0.2)', backdropFilter: tokens.cardBlur, WebkitBackdropFilter: tokens.cardBlur, border: `1px solid ${tokens.primaryBorder}` }}>
          <div style={{ fontSize: '64px', marginBottom: '16px' }}>✅</div>
          <h2 style={{ fontSize: '22px', color: tokens.text, margin: '0 0 10px 0' }}>
            {editOrderId ? t('placeOrder.orderUpdated') : t('placeOrder.orderPlaced')}
          </h2>
          <p style={{ color: tokens.muted, fontSize: '14px', margin: '0 0 24px 0' }}>
            {editOrderId
              ? t('placeOrder.orderUpdatedDesc')
              : t('placeOrder.orderPlacedDesc')}
          </p>
          <button
            onClick={() => navigate('/customer-home')}
            style={{ width: '100%', padding: '14px', background: tokens.gradientPrimary, color: 'white', border: 'none', borderRadius: '10px', fontSize: '16px', fontWeight: 'bold', cursor: 'pointer' }}
          >
            {t('placeOrder.backToHome')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: tokens.pageBg, padding: '20px', paddingBottom: '100px' }}>

      {/* Header */}
      <div style={{ maxWidth: '800px', margin: '0 auto 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(0,0,0,0.30)', borderRadius: '16px', padding: '12px 16px', backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)' }}>
        <button
          onClick={() => navigate('/customer-home')}
          style={{ padding: '8px 16px', background: 'rgba(255,255,255,0.15)', color: 'white', border: '1px solid rgba(255,255,255,0.3)', borderRadius: '8px', fontSize: '14px', fontWeight: 'bold', cursor: 'pointer' }}
        >
          ← {t('common.back')}
        </button>
        <h1 style={{ color: 'white', fontSize: '20px', margin: 0, textShadow: '0 1px 4px rgba(0,0,0,0.4)' }}>
          {editOrderId ? `✏️ ${t('placeOrder.editOrder')}` : `🛒 ${t('placeOrder.newDelivery')}`}
        </h1>
        <div style={{ width: '80px' }} />
      </div>

      <div style={{ maxWidth: '800px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '16px' }}>

        {/* Unpaid orders block — daily later_pay */}
        {blockedByUnpaid && (
          <div style={{ background: '#fdecea', border: `2px solid ${theme.error}`, borderRadius: '16px', padding: '20px' }}>
            <p style={{ margin: '0 0 8px 0', fontWeight: '700', color: theme.error, fontSize: '16px' }}>🚫 {t('placeOrder.outstandingBalance')}</p>
            <p style={{ margin: '0 0 16px 0', fontSize: '14px', color: theme.error }}>
              {t('placeOrder.outstandingDesc')}
            </p>
            <button
              onClick={() => navigate('/orders')}
              style={{ padding: '12px 24px', background: tokens.gradientPrimary, color: 'white', border: 'none', borderRadius: '8px', fontSize: '14px', fontWeight: 'bold', cursor: 'pointer' }}
            >
              💳 {t('placeOrder.viewPayBills')}
            </button>
          </div>
        )}

        {/* Voucher summary banner (pre_pay only) */}
        {isPrePay && productVouchers.size > 0 && (
          <div style={{ background: tokens.card, borderRadius: '16px', padding: '16px 20px', boxShadow: '0 4px 20px rgba(0,0,0,0.15)', backdropFilter: tokens.cardBlur, WebkitBackdropFilter: tokens.cardBlur, border: `1px solid ${tokens.primaryBorder}` }}>
            <p style={{ fontSize: '13px', fontWeight: '600', color: tokens.muted, margin: '0 0 10px 0' }}>🎫 {t('account.voucherBalance')}</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {products
                .filter(p => productVouchers.has(p.id))
                .map(p => (
                  <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}>
                    <span style={{ color: tokens.text }}>{p.name}</span>
                    <span style={{ fontWeight: 'bold', color: (productVouchers.get(p.id) ?? 0) > 0 ? tokens.primary : theme.error }}>
                      {productVouchers.get(p.id) ?? 0}
                    </span>
                  </div>
                ))}
            </div>
          </div>
        )}

        {/* Delivery Date */}
        <div style={{ background: tokens.card, borderRadius: '16px', padding: '20px', boxShadow: '0 4px 20px rgba(0,0,0,0.15)', backdropFilter: tokens.cardBlur, WebkitBackdropFilter: tokens.cardBlur, border: `1px solid ${tokens.primaryBorder}` }}>
          <label style={{ fontSize: '14px', fontWeight: '600', color: tokens.text, display: 'block', marginBottom: '10px' }}>
            📅 {t('placeOrder.deliveryDate')}
          </label>
          <input
            type="date"
            value={deliveryDate}
            min={today}
            onChange={e => setDeliveryDate(e.target.value)}
            style={{ width: '100%', padding: '12px', fontSize: '16px', border: `2px solid ${tokens.primary}`, borderRadius: '8px', outline: 'none', boxSizing: 'border-box', background: tokens.inputBg, color: tokens.text, colorScheme: isDark ? 'dark' : 'light' }}
          />
        </div>

        {/* Products */}
        <div style={{ background: tokens.card, borderRadius: '16px', padding: '20px', boxShadow: '0 4px 20px rgba(0,0,0,0.15)', backdropFilter: tokens.cardBlur, WebkitBackdropFilter: tokens.cardBlur, border: `1px solid ${tokens.primaryBorder}` }}>
          <p style={{ fontSize: '14px', fontWeight: '600', color: tokens.text, margin: '0 0 16px 0' }}>🛍️ {t('placeOrder.selectProducts')}</p>
          {products.length === 0 ? (
            <p style={{ color: tokens.muted, textAlign: 'center', padding: '20px 0' }}>{t('placeOrder.noProducts')}</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
              {/* Main products */}
              {products.filter(p => !isAccessory(p)).map((product, idx, arr) => {
                const qty = cart.get(product.id) || 0;
                const unitPrice = getUnitPrice(product);
                const plusDisabled = false;

                return (
                  <Fragment key={product.id}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px', background: qty > 0 ? tokens.primaryBg : 'transparent', borderRadius: qty > 0 ? '10px' : '0', border: qty > 0 ? `2px solid ${tokens.primary}` : 'none', margin: qty > 0 ? '4px 0' : '0' }}>
                    <div style={{ flex: 1 }}>
                      <p style={{ margin: 0, fontWeight: '600', fontSize: '14px', color: tokens.text }}>{product.name}</p>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '2px', flexWrap: 'wrap' }}>
                        <span style={{ fontSize: '13px', color: tokens.muted }}>
                          {formatCurrency(unitPrice)} / {product.unit}
                          {!isPrePay && product.is_refill && freshDiscount > 0 && (
                            <span style={{ marginLeft: '6px', color: theme.success, fontSize: '11px' }}>
                              (disc. {formatCurrency(freshDiscount)})
                            </span>
                          )}
                        </span>
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <button
                        onClick={() => updateCart(product.id, -1)}
                        disabled={qty === 0}
                        style={{ width: '32px', height: '32px', borderRadius: '50%', border: 'none', background: qty > 0 ? tokens.primary : isDark ? 'rgba(255,255,255,0.12)' : '#ddd', color: 'white', fontSize: '18px', fontWeight: 'bold', cursor: qty > 0 ? 'pointer' : 'not-allowed', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                      >
                        −
                      </button>
                      <span style={{ width: '28px', textAlign: 'center', fontWeight: 'bold', fontSize: '16px' }}>{qty}</span>
                      <button
                        onClick={() => updateCart(product.id, 1)}
                        disabled={plusDisabled}
                        style={{ width: '32px', height: '32px', borderRadius: '50%', border: 'none', background: plusDisabled ? isDark ? 'rgba(255,255,255,0.12)' : '#ddd' : tokens.primary, color: 'white', fontSize: '18px', fontWeight: 'bold', cursor: plusDisabled ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                      >
                        +
                      </button>
                    </div>
                  </div>
                  {idx < arr.length - 1 && (
                    <div style={{ height: 1, background: tokens.divider, margin: '0 4px' }} />
                  )}
                  </Fragment>
                );
              })}

              {/* Accessories toggle */}
              {products.some(p => isAccessory(p)) && (
                <>
                  <button
                    onClick={() => setShowAccessories(v => !v)}
                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', padding: '10px 14px', background: tokens.primaryBg, border: `1px dashed ${tokens.primary}`, borderRadius: '10px', cursor: 'pointer', fontSize: '13px', fontWeight: '600', color: tokens.primary }}
                  >
                    <span>🔧 {t('placeOrder.accessories')}</span>
                    <span>{showAccessories ? t('placeOrder.hideAccessories') : t('placeOrder.showAccessories')} {showAccessories ? '▲' : '▼'}</span>
                  </button>

                  {showAccessories && products.filter(p => isAccessory(p)).map((product, idx, arr) => {
                    const qty = cart.get(product.id) || 0;
                    const unitPrice = getUnitPrice(product);
                    const plusDisabled = false;

                    return (
                      <Fragment key={product.id}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px', background: qty > 0 ? tokens.primaryBg : 'transparent', borderRadius: qty > 0 ? '10px' : '0', border: qty > 0 ? `2px solid ${tokens.primary}` : 'none', margin: qty > 0 ? '4px 0' : '0' }}>
                        <div style={{ flex: 1 }}>
                          <p style={{ margin: 0, fontWeight: '600', fontSize: '14px', color: tokens.text }}>{product.name}</p>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '2px', flexWrap: 'wrap' }}>
                            <span style={{ fontSize: '13px', color: tokens.muted }}>
                              {formatCurrency(unitPrice)} / {product.unit}
                            </span>
                          </div>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                          <button
                            onClick={() => updateCart(product.id, -1)}
                            disabled={qty === 0}
                            style={{ width: '32px', height: '32px', borderRadius: '50%', border: 'none', background: qty > 0 ? tokens.primary : isDark ? 'rgba(255,255,255,0.12)' : '#ddd', color: 'white', fontSize: '18px', fontWeight: 'bold', cursor: qty > 0 ? 'pointer' : 'not-allowed', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                          >
                            −
                          </button>
                          <span style={{ width: '28px', textAlign: 'center', fontWeight: 'bold', fontSize: '16px' }}>{qty}</span>
                          <button
                            onClick={() => updateCart(product.id, 1)}
                            disabled={plusDisabled}
                            style={{ width: '32px', height: '32px', borderRadius: '50%', border: 'none', background: plusDisabled ? isDark ? 'rgba(255,255,255,0.12)' : '#ddd' : tokens.primary, color: 'white', fontSize: '18px', fontWeight: 'bold', cursor: plusDisabled ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                          >
                            +
                          </button>
                        </div>
                      </div>
                      {idx < arr.length - 1 && (
                        <div style={{ height: 1, background: tokens.divider, margin: '0 4px' }} />
                      )}
                      </Fragment>
                    );
                  })}
                </>
              )}
            </div>
          )}
        </div>

        {/* Notes */}
        <div style={{ background: tokens.card, borderRadius: '16px', padding: '20px', boxShadow: '0 4px 20px rgba(0,0,0,0.15)', backdropFilter: tokens.cardBlur, WebkitBackdropFilter: tokens.cardBlur, border: `1px solid ${tokens.primaryBorder}` }}>
          <label style={{ fontSize: '14px', fontWeight: '600', color: tokens.text, display: 'block', marginBottom: '10px' }}>
            📝 {t('placeOrder.notes')}
          </label>
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder={t('placeOrder.notesPlaceholder')}
            rows={3}
            style={{ width: '100%', padding: '12px', fontSize: '14px', border: `2px solid ${tokens.primary}`, borderRadius: '8px', outline: 'none', resize: 'vertical', fontFamily: 'inherit', boxSizing: 'border-box', background: tokens.inputBg, color: tokens.text }}
          />
        </div>

        {/* Order Summary */}
        {cartItems.length > 0 && (
          <div style={{ background: tokens.card, borderRadius: '16px', padding: '20px', boxShadow: '0 4px 20px rgba(0,0,0,0.15)', backdropFilter: tokens.cardBlur, WebkitBackdropFilter: tokens.cardBlur, border: `1px solid ${tokens.primaryBorder}` }}>
            <p style={{ fontSize: '14px', fontWeight: '600', color: tokens.text, margin: '0 0 12px 0' }}>📋 {t('placeOrder.orderSummary')}</p>
            {cartItems.map(item => (
              <div key={item.product.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', color: tokens.muted, marginBottom: '6px' }}>
                <span>{item.product.name} × {item.quantity}</span>
                <span>{formatCurrency(getUnitPrice(item.product) * item.quantity)}</span>
              </div>
            ))}
            <div style={{ borderTop: '1px solid #eee', marginTop: '10px', paddingTop: '10px', display: 'flex', justifyContent: 'space-between', fontWeight: 'bold', fontSize: '16px' }}>
              <span>{t('common.total')}</span>
              <span style={{ color: tokens.primary }}>{formatCurrency(totalAmount)}</span>
            </div>
          </div>
        )}

        {/* Payment breakdown (pre_pay with QRIS, or later_pay with vouchers applied) */}
        {cartItems.length > 0 && (isPrePay ? payableAmount > 0 : voucherBreakdown.some(v => v.byVoucher > 0)) && (
          <div style={{ background: tokens.card, borderRadius: '16px', padding: '20px', boxShadow: '0 4px 20px rgba(0,0,0,0.15)', backdropFilter: tokens.cardBlur, WebkitBackdropFilter: tokens.cardBlur, border: `1px solid ${tokens.primaryBorder}` }}>
            <p style={{ margin: '0 0 12px 0', fontWeight: '700', color: tokens.text, fontSize: '14px' }}>💳 {t('placeOrder.paymentBreakdown')}</p>
            {voucherBreakdown.filter(({ byPayment }) => byPayment > 0).map(({ item, byVoucher, byPayment }) => {
              const available = productVouchers.get(item.product.id) ?? 0;
              return (
                <div key={item.product.id} style={{ marginBottom: '10px', padding: '10px 12px', background: tokens.primaryBg, borderRadius: '10px', border: `1px solid ${tokens.primaryBorder}` }}>
                  <p style={{ margin: '0 0 6px 0', fontWeight: '600', fontSize: '13px', color: tokens.text }}>{item.product.name} × {item.quantity}</p>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: tokens.muted, marginBottom: '3px' }}>
                    <span>🎫 {t('placeOrder.currentVouchers')}: <strong style={{ color: tokens.primary }}>{available}</strong></span>
                    {byVoucher > 0 && <span style={{ color: tokens.primary }}>{t('placeOrder.coveredBy')} {byVoucher}</span>}
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: tokens.muted }}>
                    <span>{t('placeOrder.atFullPrice')}: <strong>{byPayment}</strong></span>
                    <span style={{ fontWeight: '600', color: tokens.text }}>{formatCurrency(byPayment * getUnitPrice(item.product))}</span>
                  </div>
                </div>
              );
            })}
            <div style={{ borderTop: `1px solid ${tokens.divider}`, marginTop: '4px', paddingTop: '12px', display: 'flex', justifyContent: 'space-between', fontWeight: '700', fontSize: '15px', color: tokens.text }}>
              <span>{isPrePay ? t('placeOrder.payViaQris') : t('placeOrder.onCredit')}</span>
              <span style={{ color: tokens.primary }}>{formatCurrency(payableAmount)}</span>
            </div>
            {payableAmount < totalAmount && (
              <p style={{ margin: '6px 0 0', fontSize: '12px', color: tokens.muted }}>
                {formatCurrency(totalAmount - payableAmount)} {t('placeOrder.voucherCovered')}
              </p>
            )}
            {!isPrePay && creditLimit !== null && (
              <p style={{ margin: '6px 0 0', fontSize: '12px', color: unpaidCredit + payableAmount > creditLimit ? theme.error : tokens.muted }}>
                {t('home.creditLimit')}: {formatCurrency(Math.max(0, creditLimit - unpaidCredit))} {t('placeOrder.remaining')}
              </p>
            )}
          </div>
        )}

        {/* Unpaid orders block */}
        {error === 'UNPAID_ORDERS' && (
          <div style={{ background: '#fdecea', border: `2px solid ${theme.error}`, borderRadius: '12px', padding: '16px' }}>
            <p style={{ margin: '0 0 8px 0', fontWeight: '700', color: theme.error, fontSize: '14px' }}>
              🚫 {t('placeOrder.unpaidBills')}
            </p>
            <p style={{ margin: '0 0 12px 0', fontSize: '13px', color: theme.error }}>
              {t('placeOrder.unpaidBillsDesc')}
            </p>
            <button
              onClick={() => navigate('/orders')}
              style={{ padding: '10px 20px', background: tokens.gradientPrimary, color: 'white', border: 'none', borderRadius: '8px', fontSize: '14px', fontWeight: 'bold', cursor: 'pointer' }}
            >
              💳 {t('placeOrder.viewPayBills')}
            </button>
          </div>
        )}

        {/* Credit limit exceeded */}
        {error === 'CREDIT_LIMIT_EXCEEDED' && (
          <div style={{ background: '#fdecea', border: `2px solid ${theme.error}`, borderRadius: '12px', padding: '16px' }}>
            <p style={{ margin: '0 0 6px 0', fontWeight: '700', color: theme.error, fontSize: '14px' }}>
              🚫 {t('placeOrder.creditLimitExceeded')}
            </p>
            <p style={{ margin: 0, fontSize: '13px', color: theme.error }}>
              {t('placeOrder.creditLimitDesc')}{creditLimit !== null ? ` (${formatCurrency(Math.max(0, creditLimit - unpaidCredit))} ${t('placeOrder.remaining')})` : ''}
            </p>
          </div>
        )}

        {/* Error */}
        {error && error !== 'UNPAID_ORDERS' && error !== 'CREDIT_LIMIT_EXCEEDED' && (
          <div style={{ background: '#fdecea', border: `2px solid ${theme.error}`, borderRadius: '12px', padding: '14px 16px', color: theme.error, fontSize: '14px' }}>
            ⚠️ {error}
          </div>
        )}

        {/* Submit */}
        <button
          onClick={() => {
            if (blockedByUnpaid) { setShowUnpaidModal(true); return; }
            if (isPrePay && !hasEnoughVouchers) { handlePayWithQris(); return; }
            handleSubmit();
          }}
          disabled={submitting || cartItems.length === 0}
          style={{
            width: '100%', padding: '16px',
            background: (submitting || cartItems.length === 0) ? (isDark ? 'rgba(255,255,255,0.1)' : '#ccc') : tokens.gradientPrimary,
            color: 'white', border: 'none', borderRadius: '12px', fontSize: '16px', fontWeight: 'bold',
            cursor: (submitting || cartItems.length === 0) ? 'not-allowed' : 'pointer',
          }}
        >
          {submitting
            ? t('placeOrder.processing')
            : editOrderId
              ? `✅ ${t('placeOrder.update')}`
              : isPrePay && !hasEnoughVouchers && cartItems.length > 0
                ? `💳 ${t('placeOrder.submit')} · ${t('placeOrder.payViaQris')} ${formatCurrency(payableAmount)}`
                : `✅ ${t('placeOrder.submit')}`}
        </button>
      </div>

      <BottomNavV0 customer={customer} />

      {/* Unpaid Orders Modal */}
      {showUnpaidModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 3000, padding: '20px' }}>
          <div style={{ background: 'white', borderRadius: '20px', padding: '28px 24px', maxWidth: '360px', width: '100%', textAlign: 'center', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}>
            <p style={{ fontSize: '48px', margin: '0 0 12px 0' }}>⚠️</p>
            <h3 style={{ fontSize: '18px', fontWeight: '700', color: theme.error, margin: '0 0 12px 0' }}>{t('placeOrder.outstandingBalance')}</h3>
            <p style={{ fontSize: '14px', color: '#555', margin: '0 0 24px 0', lineHeight: '1.5' }}>
              {t('placeOrder.outstandingDesc')}
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <button
                onClick={() => { setShowUnpaidModal(false); navigate('/orders'); }}
                style={{ width: '100%', padding: '13px', background: tokens.gradientPrimary, color: 'white', border: 'none', borderRadius: '10px', fontSize: '15px', fontWeight: 'bold', cursor: 'pointer' }}
              >
                💳 {t('placeOrder.viewPayBills')}
              </button>
              <button
                onClick={() => setShowUnpaidModal(false)}
                style={{ width: '100%', padding: '11px', background: 'none', color: tokens.muted, border: `2px solid #ddd`, borderRadius: '10px', fontSize: '14px', cursor: 'pointer' }}
              >
                {t('common.close')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
