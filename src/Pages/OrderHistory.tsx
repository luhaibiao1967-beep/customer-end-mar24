// src/Pages/OrderHistory.tsx - View order history
import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import BottomNavV0 from '../Components/BottomNavV0';
import { useLanguage } from '../contexts/LanguageContext';
import { theme } from '../theme';
import { useColorTokens } from '../contexts/ColorTokensContext';
import { formatCurrency } from '../utils/format';
import toast from 'react-hot-toast';

const BANK_INFO = {
  bank: import.meta.env.VITE_BANK_NAME || 'BCA',
  account: import.meta.env.VITE_BANK_ACCOUNT || '',
  name: import.meta.env.VITE_BANK_ACCOUNT_NAME || '',
};

interface Customer {
  id: string;
  name: string;
  customer_type: string;
  payment_term?: string;
}

interface Order {
  id: string;
  customer_name: string;
  customer_address: string;
  delivery_date: string;
  status: string;
  payment_status: string;
  total_amount: number;
  created_at: string;
  delivery_evidence?: string;
  payment_evidence?: string;
  borrowed_gallons?: number;
}

interface OrderHistoryProps {
  customer: Customer;
}

export default function OrderHistory({ customer }: OrderHistoryProps) {
  const navigate = useNavigate();
  const { t } = useLanguage();
  const { tokens } = useColorTokens();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [initialBorrowedGallons, setInitialBorrowedGallons] = useState(0);
  const [productVouchers, setProductVouchers] = useState<{ product_id: string; balance: number; products: { name: string } | null }[]>([]);

  const [payingIds, setPayingIds] = useState<Set<string>>(new Set());

  // Bank Transfer modal (covers all unpaid outstanding)
  const [showBankTransfer, setShowBankTransfer] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadSuccess, setUploadSuccess] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // View payment evidence modal
  const [paymentEvidenceUrl, setPaymentEvidenceUrl] = useState<string | null>(null);
  const [loadingEvidenceId, setLoadingEvidenceId] = useState<string | null>(null);

  useEffect(() => {
    fetchOrders();
    if (customer.customer_type === 'pre_pay') fetchProductVoucherTotal();
  }, [customer.id]);

  const fetchProductVoucherTotal = async () => {
    try {
      const { data } = await supabase
        .from('customer_product_vouchers')
        .select('product_id, balance, products(name)')
        .eq('customer_id', customer.id);
      setProductVouchers((data as any) || []);
    } catch {
      // silently fail
    }
  };

  const fetchOrders = async () => {
    try {
      setLoading(true);
      const token = sessionStorage.getItem('auth_token');
      if (!token) throw new Error('Session expired, please login again');

      const { data, error } = await supabase.functions.invoke('get-orders', {
        body: { token },
      });

      if (error) throw new Error(error.message);
      if (!data?.success) throw new Error(data?.error || 'Failed to load orders');

      setOrders(data.orders || []);
      setInitialBorrowedGallons(data.initial_borrowed_gallons || 0);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const loadSnapScript = (clientKey: string, snapJsUrl: string): Promise<void> =>
    new Promise((resolve) => {
      if ((window as any).snap) { resolve(); return; }
      const existing = document.querySelector('script[data-midtrans-snap]');
      if (existing) { existing.addEventListener('load', () => resolve()); return; }
      const script = document.createElement('script');
      script.src = snapJsUrl;
      script.setAttribute('data-client-key', clientKey);
      script.setAttribute('data-midtrans-snap', 'true');
      script.onload = () => resolve();
      document.body.appendChild(script);
    });

  const handlePayWithQris = async (orderIds: string[]) => {
    setPayingIds(prev => new Set([...prev, ...orderIds]));
    try {
      const token = sessionStorage.getItem('auth_token');
      if (!token) throw new Error('Session expired');

      const { data, error } = await supabase.functions.invoke('create-order-payment', {
        body: { token, order_ids: orderIds, enabled_payments: ['other_qris'] },
      });

      if (error) throw new Error(error.message);
      if (!data?.success) throw new Error(data?.error || 'Failed to create payment');

      await loadSnapScript(data.client_key, data.snap_js_url);

      const midtransOrderId = data.midtrans_order_id;
      (window as any).snap.pay(data.snap_token, {
        onSuccess: async () => {
          try {
            await supabase.functions.invoke('confirm-snap-payment', {
              body: { token, midtrans_order_id: midtransOrderId },
            });
          } catch (_) { /* webhook will handle it as fallback */ }
          fetchOrders();
          toast.success(t('orderHistory.paymentSuccess'));
        },
        onPending: () => { toast(t('orderHistory.paymentPending'), { duration: 6000 }); },
        onError: (result: any) => { toast.error(t('orderHistory.paymentFailed') + ' ' + (result?.status_message || 'Unknown error')); },
        onClose: () => { /* user dismissed without paying */ },
      });
    } catch (err: any) {
      toast.error('Error: ' + err.message);
    } finally {
      setPayingIds(prev => {
        const next = new Set(prev);
        orderIds.forEach(id => next.delete(id));
        return next;
      });
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setSelectedFile(file);
    setPreviewUrl(URL.createObjectURL(file));
    setUploadSuccess(false);
  };

  const handleUploadEvidence = async () => {
    if (!selectedFile) return;
    setUploading(true);
    try {
      const token = sessionStorage.getItem('auth_token');
      if (!token) throw new Error('Session expired');

      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(selectedFile);
      });

      const targetIds = unpaidOrders.map(o => o.id);

      const { data, error } = await supabase.functions.invoke('payment-action', {
        body: {
          token,
          action: 'upload',
          order_ids: targetIds,
          file_base64: base64,
          file_type: selectedFile.type,
        },
      });

      if (error) throw new Error(error.message);
      if (!data?.success) throw new Error(data?.error || 'Upload failed');

      setUploadSuccess(true);
      setOrders(prev => prev.map(o =>
        targetIds.includes(o.id) ? { ...o, payment_evidence: data.path } : o
      ));
    } catch (err: any) {
      toast.error(t('orderHistory.uploadFailed') + err.message);
    } finally {
      setUploading(false);
    }
  };

  const handleViewPaymentEvidence = async (order: Order) => {
    setLoadingEvidenceId(order.id);
    try {
      const token = sessionStorage.getItem('auth_token');
      if (!token) throw new Error('Session expired');

      const { data, error } = await supabase.functions.invoke('payment-action', {
        body: { token, action: 'view', order_id: order.id },
      });

      if (error) throw new Error(error.message);
      if (!data?.success) throw new Error(data?.error || 'Failed to get URL');

      setPaymentEvidenceUrl(data.url);
    } catch (err: any) {
      toast.error(t('orderHistory.evidenceFailed') + err.message);
    } finally {
      setLoadingEvidenceId(null);
    }
  };

  const closeUploadModal = () => {
    setShowBankTransfer(false);
    setSelectedFile(null);
    setPreviewUrl(null);
    setUploadSuccess(false);
  };

  const isLaterPay = customer.customer_type !== 'pre_pay';

  const unpaidOrders = orders.filter(o => o.payment_status === 'unpaid');
  const unpaidDeliveredOrders = unpaidOrders.filter(o => o.status === 'delivered');
  const totalUnpaid = unpaidOrders.reduce((sum, o) => sum + o.total_amount, 0);
  const totalBorrowedGallons = initialBorrowedGallons +
    orders.reduce((sum, o) => sum + (o.borrowed_gallons || 0), 0);

  const isPayingAll = unpaidOrders.some(o => payingIds.has(o.id));

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'pending': return theme.warning;
      case 'scheduled': return theme.info;
      case 'delivered': return theme.success;
      default: return '#999';
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'pending': return t('home.statusPending');
      case 'scheduled': return t('home.statusScheduled');
      case 'delivered': return t('orders.statusDelivered');
      case 'cancelled': return t('orders.statusCancelled');
      default: return status.toUpperCase();
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'pending': return '⏳';
      case 'scheduled': return '📅';
      case 'delivered': return '✅';
      default: return '📦';
    }
  };

  const formatDate = (dateString: string) =>
    new Date(dateString).toLocaleDateString('id-ID', { timeZone: 'Asia/Jakarta', year: 'numeric', month: 'long', day: 'numeric' });

  return (
    <div style={{ minHeight: '100vh', background: tokens.pageBg, padding: '14px', paddingBottom: '88px' }}>

      {/* Header */}
      <div style={{ maxWidth: '800px', margin: '0 auto 6px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: tokens.topBarGradient, border: `1px solid ${tokens.cardBorder}`, borderRadius: '16px', padding: '10px 14px', boxShadow: '0 4px 16px rgba(0,105,113,0.2)' }}>
        <button onClick={() => navigate('/customer-home')} style={{ padding: '8px 16px', background: 'rgba(255,255,255,0.15)', color: 'white', border: '1px solid rgba(255,255,255,0.3)', borderRadius: '8px', fontSize: '14px', fontWeight: 'bold', cursor: 'pointer' }}>
          ← {t('common.back')}
        </button>
        <h1 style={{ color: 'white', fontSize: '22px', margin: 0, display: 'flex', alignItems: 'center', gap: '8px', textShadow: '0 1px 4px rgba(0,0,0,0.4)' }}>
          {t('orders.title')}
        </h1>
        <div style={{ width: '80px' }} />
      </div>

      <div style={{ maxWidth: '800px', margin: '0 auto' }}>

        {/* Summary banner — later_pay */}
        {isLaterPay && (totalUnpaid > 0 || totalBorrowedGallons > 0) && (
          <div style={{ background: tokens.card, borderRadius: '16px', padding: '12px 16px', marginBottom: '6px', boxShadow: '0 4px 20px rgba(0,0,0,0.15)', backdropFilter: tokens.cardBlur, WebkitBackdropFilter: tokens.cardBlur }}>

            {/* Balance row */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: unpaidOrders.length > 0 ? '10px' : '0' }}>
              <div style={{ borderLeft: `4px solid ${theme.error}`, paddingLeft: '12px' }}>
                <p style={{ margin: 0, fontSize: '11px', color: tokens.muted }}>{t('orderHistory.outstandingBalance')}</p>
                <p style={{ margin: '4px 0 0', fontSize: '18px', fontWeight: 'bold', color: totalUnpaid > 0 ? theme.error : theme.success }}>
                  {totalUnpaid > 0 ? formatCurrency(totalUnpaid) : `✅ ${t('orderHistory.clear')}`}
                </p>
                {unpaidOrders.length > 1 && (
                  <p style={{ margin: '2px 0 0', fontSize: '11px', color: tokens.muted }}>{unpaidOrders.length} orders</p>
                )}
              </div>
              <div style={{ borderLeft: `4px solid ${tokens.primary}`, paddingLeft: '12px' }}>
                <p style={{ margin: 0, fontSize: '11px', color: tokens.muted }}>{t('orderHistory.borrowedGallons')}</p>
                <p style={{ margin: '4px 0 0', fontSize: '18px', fontWeight: 'bold', color: tokens.primary }}>
                  {totalBorrowedGallons} gallons
                </p>
              </div>
            </div>

            {/* Payment buttons — shown whenever there is outstanding */}
            {unpaidOrders.length > 0 && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <button
                  onClick={() => handlePayWithQris(unpaidOrders.map(o => o.id))}
                  disabled={isPayingAll}
                  style={{ padding: '12px', background: isPayingAll ? '#ccc' : tokens.gradientSuccess, color: 'white', border: 'none', borderRadius: '10px', fontSize: '14px', fontWeight: 'bold', cursor: isPayingAll ? 'not-allowed' : 'pointer' }}
                >
                  {isPayingAll ? 'Loading...' : t('orderHistory.payViaQris')}
                </button>
                <button
                  onClick={() => setShowBankTransfer(true)}
                  style={{ padding: '12px', background: tokens.card, color: tokens.primary, border: `2px solid ${tokens.primary}`, borderRadius: '10px', fontSize: '14px', fontWeight: 'bold', cursor: 'pointer' }}
                >
                  {t('orderHistory.bankTransfer')}
                </button>
              </div>
            )}
          </div>
        )}

        {/* Summary banner — pre_pay: per-product voucher breakdown */}
        {!isLaterPay && productVouchers.length > 0 && (
          <div style={{ background: tokens.card, borderRadius: '16px', padding: '12px 16px', marginBottom: '6px', boxShadow: '0 4px 20px rgba(0,0,0,0.15)', backdropFilter: tokens.cardBlur, WebkitBackdropFilter: tokens.cardBlur }}>
            <p style={{ margin: '0 0 8px 0', fontSize: '11px', color: tokens.muted, fontWeight: '600' }}>🎫 {t('account.voucherBalance')}</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {productVouchers.map(row => (
                <div key={row.product_id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderLeft: `4px solid ${tokens.primary}`, paddingLeft: '12px' }}>
                  <span style={{ fontSize: '13px', color: tokens.text }}>{row.products?.name ?? '—'}</span>
                  <span style={{ fontSize: '18px', fontWeight: 'bold', color: tokens.primary }}>{row.balance}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Order list */}
        {loading ? (
          <div style={{ background: tokens.card, borderRadius: '20px', padding: '60px', textAlign: 'center', backdropFilter: tokens.cardBlur, WebkitBackdropFilter: tokens.cardBlur }}>
            <div style={{ width: '50px', height: '50px', border: '4px solid #f3f3f3', borderTop: `4px solid ${tokens.primary}`, borderRadius: '50%', margin: '0 auto 20px', animation: 'spin 1s linear infinite' }} />
            <p style={{ color: '#666' }}>{t('orderHistory.loading')}</p>
            <style>{`@keyframes spin{0%{transform:rotate(0deg)}100%{transform:rotate(360deg)}}`}</style>
          </div>
        ) : error ? (
          <div style={{ background: tokens.card, borderRadius: '20px', padding: '40px', textAlign: 'center', backdropFilter: tokens.cardBlur, WebkitBackdropFilter: tokens.cardBlur }}>
            <p style={{ fontSize: '48px', margin: '0 0 20px 0' }}>⚠️</p>
            <p style={{ color: '#666', marginBottom: '20px' }}>{error}</p>
            <button onClick={fetchOrders} style={{ padding: '12px 30px', background: tokens.gradientPrimary, color: 'white', border: 'none', borderRadius: '8px', fontSize: '16px', fontWeight: 'bold', cursor: 'pointer' }}>{t('orders.tryAgain')}</button>
          </div>
        ) : orders.length === 0 ? (
          <div style={{ background: tokens.card, borderRadius: '20px', padding: '60px', textAlign: 'center', backdropFilter: tokens.cardBlur, WebkitBackdropFilter: tokens.cardBlur }}>
            <p style={{ fontSize: '64px', margin: '0 0 20px 0' }}>📦</p>
            <h2 style={{ fontSize: '24px', marginBottom: '15px' }}>{t('orders.empty')}</h2>
            <button onClick={() => navigate('/place-order')} style={{ padding: '12px 30px', background: tokens.gradientPrimary, color: 'white', border: 'none', borderRadius: '8px', fontSize: '16px', fontWeight: 'bold', cursor: 'pointer' }}>🛒 {t('orderHistory.newOrder')}</button>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {orders.map((order) => (
              <div key={order.id} style={{ background: tokens.card, borderRadius: '16px', padding: '14px', boxShadow: '0 4px 20px rgba(0,0,0,0.12)', backdropFilter: tokens.cardBlur, WebkitBackdropFilter: tokens.cardBlur }}>

                {/* Status + date */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                  <span style={{ background: getStatusColor(order.status), color: 'white', padding: '4px 12px', borderRadius: '20px', fontSize: '12px', fontWeight: 'bold' }}>
                    {getStatusIcon(order.status)} {getStatusLabel(order.status)}
                  </span>
                  <span style={{ fontSize: '12px', color: tokens.muted }}>🗓️ {formatDate(order.delivery_date)}</span>
                </div>

                {/* Amount + payment status */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                  <span style={{ fontSize: '18px', fontWeight: 'bold', color: tokens.text }}>{formatCurrency(order.total_amount)}</span>
                  <span style={{ fontSize: '13px', fontWeight: '600', color: order.payment_status === 'paid' ? theme.success : theme.error }}>
                    {order.payment_status === 'paid' ? `✅ ${t('orderHistory.paid')}` : `⏳ ${t('orderHistory.unpaid')}`}
                  </span>
                </div>

                <p style={{ fontSize: '12px', color: tokens.muted, margin: '0 0 8px 0' }}>
                  Order #{order.id.slice(0, 8)} · {formatDate(order.created_at)}
                </p>

                {/* Buttons */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {order.status === 'pending' ? (
                    customer.customer_type === 'pre_pay' && order.payment_status === 'paid' ? (
                      // Paid pre_pay order: locked, no edit/cancel
                      <div style={{ padding: '8px 12px', background: '#f0fdf4', borderRadius: '8px', fontSize: '13px', color: '#15803d', textAlign: 'center' }}>
                        {`✅ ${t('orderHistory.orderConfirmedLocked')}`}
                      </div>
                    ) : customer.customer_type === 'pre_pay' && order.payment_status === 'unpaid' ? (
                      // Pre_pay order awaiting payment
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        <div style={{ padding: '8px 12px', background: '#fff3cd', borderRadius: '8px', fontSize: '13px', color: '#856404', textAlign: 'center' }}>
                          {`⏳ ${t('orderHistory.awaitingPayment')}`}
                        </div>
                        <button
                          onClick={() => handlePayWithQris([order.id])}
                          disabled={payingIds.has(order.id)}
                          style={{ padding: '10px', background: payingIds.has(order.id) ? '#ccc' : tokens.gradientPrimary, color: 'white', border: 'none', borderRadius: '8px', fontSize: '14px', fontWeight: 'bold', cursor: payingIds.has(order.id) ? 'not-allowed' : 'pointer' }}
                        >
                          {payingIds.has(order.id) ? 'Loading...' : t('orderHistory.completePaymentQris')}
                        </button>
                      </div>
                    ) : (
                      // later_pay: edit + QRIS; cancellation is done in the staff app only
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        <button onClick={() => navigate(`/place-order?edit=${order.id}`)} style={{ padding: '10px', background: theme.info, color: 'white', border: 'none', borderRadius: '8px', fontSize: '14px', fontWeight: 'bold', cursor: 'pointer' }}>
                          {t('home.edit')}
                        </button>
                        {order.payment_status === 'unpaid' && (
                          <button
                            onClick={() => handlePayWithQris([order.id])}
                            disabled={payingIds.has(order.id)}
                            style={{ padding: '10px', background: payingIds.has(order.id) ? '#ccc' : tokens.gradientSuccess, color: 'white', border: 'none', borderRadius: '8px', fontSize: '14px', fontWeight: 'bold', cursor: payingIds.has(order.id) ? 'not-allowed' : 'pointer' }}
                          >
                            {payingIds.has(order.id) ? 'Loading...' : t('orderHistory.payViaQris')}
                          </button>
                        )}
                      </div>
                    )
                  ) : order.status === 'scheduled' ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      <div style={{ padding: '8px 12px', background: '#f5f5f5', borderRadius: '8px', fontSize: '12px', color: tokens.muted, textAlign: 'center' }}>
                        {`ℹ️ ${t('orderHistory.orderConfirmed')}`}
                      </div>
                      {isLaterPay && order.payment_status === 'unpaid' && (
                        <button
                          onClick={() => handlePayWithQris([order.id])}
                          disabled={payingIds.has(order.id)}
                          style={{ padding: '10px', background: payingIds.has(order.id) ? '#ccc' : tokens.gradientSuccess, color: 'white', border: 'none', borderRadius: '8px', fontSize: '14px', fontWeight: 'bold', cursor: payingIds.has(order.id) ? 'not-allowed' : 'pointer' }}
                        >
                          {payingIds.has(order.id) ? 'Loading...' : t('orderHistory.payViaQris')}
                        </button>
                      )}
                    </div>
                  ) : null}

                  {/* View payment evidence */}
                  {order.payment_evidence && (
                    <button
                      onClick={() => handleViewPaymentEvidence(order)}
                      disabled={loadingEvidenceId === order.id}
                      style={{ padding: '10px', background: tokens.primaryBg, color: tokens.primary, border: `2px solid ${tokens.primary}`, borderRadius: '8px', fontSize: '14px', fontWeight: 'bold', cursor: 'pointer' }}
                    >
                      {loadingEvidenceId === order.id ? '...' : `🧾 ${t('orderHistory.viewPaymentReceipt')}`}
                    </button>
                  )}

                  {/* View Delivery Details */}
                  <button
                    onClick={() => navigate(`/orders/${order.id}/delivery`)}
                    style={{ padding: '10px', background: tokens.gradientPrimary, color: 'white', border: 'none', borderRadius: '8px', fontSize: '14px', fontWeight: 'bold', cursor: 'pointer', transition: 'transform 0.2s' }}
                    onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-2px)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.transform = 'translateY(0)'; }}
                  >
                    {t('orders.viewDetails')}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Bank Transfer Modal ── */}
      {showBankTransfer && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 2000 }}>
          <div style={{ background: 'white', borderRadius: '20px 20px 0 0', width: '100%', maxWidth: '500px', maxHeight: '90vh', overflowY: 'auto' }}>

            {/* Modal header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 20px', borderBottom: '1px solid #eee', position: 'sticky', top: 0, background: 'white', zIndex: 1 }}>
              <div>
                <p style={{ margin: 0, fontWeight: '700', fontSize: '16px' }}>{t('orderHistory.bankTransfer')}</p>
                <p style={{ margin: 0, fontSize: '13px', color: tokens.muted }}>
                  {unpaidOrders.length} order(s) · {formatCurrency(totalUnpaid)}
                </p>
              </div>
              <button onClick={closeUploadModal} style={{ background: 'none', border: 'none', fontSize: '22px', cursor: 'pointer', color: tokens.muted }}>✕</button>
            </div>

            <div style={{ padding: '20px' }}>
              {/* Bank info */}
              <div style={{ background: '#f5f5f5', borderRadius: '12px', padding: '20px', marginBottom: '16px' }}>
                <p style={{ margin: '0 0 8px 0', fontSize: '13px', color: tokens.muted }}>{t('orderHistory.bank')}</p>
                <p style={{ margin: '0 0 16px 0', fontSize: '20px', fontWeight: 'bold', color: tokens.text }}>{BANK_INFO.bank}</p>
                <p style={{ margin: '0 0 8px 0', fontSize: '13px', color: tokens.muted }}>{t('orderHistory.accountNumber')}</p>
                <p style={{ margin: '0 0 16px 0', fontSize: '24px', fontWeight: 'bold', letterSpacing: '2px', color: tokens.primary }}>{BANK_INFO.account}</p>
                <p style={{ margin: '0 0 8px 0', fontSize: '13px', color: tokens.muted }}>{t('orderHistory.accountName')}</p>
                <p style={{ margin: 0, fontSize: '14px', fontWeight: '600', color: tokens.text }}>{BANK_INFO.name}</p>
              </div>
              <p style={{ fontSize: '13px', color: theme.error, fontWeight: '700', textAlign: 'center', marginBottom: '20px', background: '#fff3e0', padding: '10px', borderRadius: '8px' }}>
                {t('orderHistory.transferAmount') + ' '}{formatCurrency(totalUnpaid)}
                {unpaidOrders.length > 1 && ` (${unpaidOrders.length} orders)`}
              </p>

              {/* Upload evidence */}
              <div style={{ borderTop: '1px solid #eee', paddingTop: '20px' }}>
                <p style={{ fontWeight: '600', fontSize: '14px', margin: '0 0 12px 0' }}>📎 {t('orderHistory.uploadReceipt')}</p>
                {uploadSuccess ? (
                  <div style={{ background: '#e8f5e9', border: `2px solid ${theme.success}`, borderRadius: '12px', padding: '16px', textAlign: 'center' }}>
                    <p style={{ margin: 0, color: theme.success, fontWeight: '600' }}>{`✅ ${t('orderHistory.receiptUploaded')}`}</p>
                    <p style={{ margin: '8px 0 0', fontSize: '13px', color: tokens.muted }}>{t('orderHistory.confirmSoon')}</p>
                  </div>
                ) : (
                  <>
                    {previewUrl && (
                      <img src={previewUrl} alt="Preview" style={{ width: '100%', borderRadius: '10px', marginBottom: '12px', maxHeight: '200px', objectFit: 'cover' }} />
                    )}
                    <input ref={fileInputRef} type="file" accept="image/*" onChange={handleFileSelect} style={{ display: 'none' }} />
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      style={{ width: '100%', padding: '12px', background: '#f5f5f5', color: tokens.text, border: '2px dashed #ccc', borderRadius: '10px', fontSize: '14px', cursor: 'pointer', marginBottom: '10px' }}
                    >
                      {selectedFile ? `📄 ${selectedFile.name}` : `📷 ${t('orderHistory.selectPhoto')}`}
                    </button>
                    {selectedFile && (
                      <button
                        onClick={handleUploadEvidence}
                        disabled={uploading}
                        style={{ width: '100%', padding: '14px', background: uploading ? '#ccc' : tokens.gradientPrimary, color: 'white', border: 'none', borderRadius: '10px', fontSize: '15px', fontWeight: 'bold', cursor: uploading ? 'not-allowed' : 'pointer' }}
                      >
                        {uploading ? t('orderHistory.uploading') : `⬆️ ${t('orderHistory.submitReceipt')}`}
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Payment evidence modal ── */}
      {paymentEvidenceUrl && (
        <div onClick={() => setPaymentEvidenceUrl(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000, padding: '20px' }}>
          <div onClick={e => e.stopPropagation()} style={{ background: 'white', borderRadius: '16px', overflow: 'hidden', maxWidth: '500px', width: '100%' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 16px', borderBottom: '1px solid #eee' }}>
              <span style={{ fontWeight: '600' }}>🧾 {t('orderHistory.paymentReceipt')}</span>
              <button onClick={() => setPaymentEvidenceUrl(null)} style={{ background: 'none', border: 'none', fontSize: '20px', cursor: 'pointer' }}>✕</button>
            </div>
            <img src={paymentEvidenceUrl} alt="Payment receipt" style={{ width: '100%', display: 'block', maxHeight: '70vh', objectFit: 'contain' }} />
          </div>
        </div>
      )}

      <BottomNavV0 customer={customer} />
    </div>
  );
}
