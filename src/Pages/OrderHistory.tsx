// src/Pages/OrderHistory.tsx - View order history
import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import BottomNav from '../Components/BottomNav';
import { useLanguage } from '../contexts/LanguageContext';
import { theme } from '../theme';
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
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [cancellingId, setCancellingId] = useState<string | null>(null);
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

  const handleCancel = async (orderId: string) => {
    if (!confirm('Are you sure you want to cancel this order?')) return;
    setCancellingId(orderId);
    try {
      const token = sessionStorage.getItem('auth_token');
      if (!token) throw new Error('Session expired');
      const { data, error } = await supabase.functions.invoke('cancel-order', {
        body: { token, order_id: orderId },
      });
      if (error) throw new Error(error.message);
      if (!data?.success) throw new Error(data?.error || 'Failed to cancel');
      setOrders(prev => prev.filter(o => o.id !== orderId));
    } catch (err: any) {
      toast.error('Cancel failed: ' + err.message);
    } finally {
      setCancellingId(null);
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

      (window as any).snap.pay(data.snap_token, {
        onSuccess: () => { fetchOrders(); toast.success('Payment successful! Order will update shortly.'); },
        onPending: () => { toast('Payment submitted — order will be confirmed once your bank settles the transfer.', { duration: 6000 }); },
        onError: (result: any) => { toast.error('Payment failed: ' + (result?.status_message || 'Unknown error')); },
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

      const targetIds = unpaidDeliveredOrders.map(o => o.id);

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
      toast.error('Upload failed: ' + err.message);
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
      toast.error('Failed to load evidence: ' + err.message);
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

  const unpaidDeliveredOrders = orders.filter(o => o.payment_status === 'unpaid' && o.status === 'delivered');
  const totalUnpaid = unpaidDeliveredOrders.reduce((sum, o) => sum + o.total_amount, 0);
  const totalBorrowedGallons = initialBorrowedGallons +
    orders.reduce((sum, o) => sum + (o.borrowed_gallons || 0), 0);

  const isPayingAll = unpaidDeliveredOrders.some(o => payingIds.has(o.id));

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'pending': return theme.warning;
      case 'scheduled': return theme.info;
      case 'delivered': return theme.success;
      default: return '#999';
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
    <div style={{ minHeight: '100vh', background: theme.gradientPrimary, padding: '20px', paddingBottom: '80px' }}>

      {/* Header */}
      <div style={{ maxWidth: '800px', margin: '0 auto 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <button onClick={() => navigate('/customer-home')} style={{ padding: '10px 20px', background: 'rgba(255,255,255,0.2)', color: 'white', border: '2px solid white', borderRadius: '8px', fontSize: '14px', fontWeight: 'bold', cursor: 'pointer' }}>
          ← {t('common.back')}
        </button>
        <h1 style={{ color: 'white', fontSize: '22px', margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
          {t('orders.title')}
        </h1>
        <div style={{ width: '80px' }} />
      </div>

      <div style={{ maxWidth: '800px', margin: '0 auto' }}>

        {/* Summary banner — later_pay */}
        {isLaterPay && (totalUnpaid > 0 || totalBorrowedGallons > 0) && (
          <div style={{ background: 'white', borderRadius: '16px', padding: '16px 20px', marginBottom: '16px', boxShadow: '0 4px 20px rgba(0,0,0,0.15)' }}>

            {/* Balance row */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: unpaidDeliveredOrders.length > 0 ? '14px' : '0' }}>
              <div style={{ borderLeft: `4px solid ${theme.error}`, paddingLeft: '12px' }}>
                <p style={{ margin: 0, fontSize: '11px', color: theme.textMuted }}>Outstanding Balance</p>
                <p style={{ margin: '4px 0 0', fontSize: '18px', fontWeight: 'bold', color: totalUnpaid > 0 ? theme.error : theme.success }}>
                  {totalUnpaid > 0 ? formatCurrency(totalUnpaid) : '✅ Clear'}
                </p>
                {unpaidDeliveredOrders.length > 1 && (
                  <p style={{ margin: '2px 0 0', fontSize: '11px', color: theme.textMuted }}>{unpaidDeliveredOrders.length} orders</p>
                )}
              </div>
              <div style={{ borderLeft: `4px solid ${theme.primary}`, paddingLeft: '12px' }}>
                <p style={{ margin: 0, fontSize: '11px', color: theme.textMuted }}>Borrowed Gallons</p>
                <p style={{ margin: '4px 0 0', fontSize: '18px', fontWeight: 'bold', color: theme.primary }}>
                  {totalBorrowedGallons} gallons
                </p>
              </div>
            </div>

            {/* Payment buttons — shown whenever there is outstanding */}
            {unpaidDeliveredOrders.length > 0 && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <button
                  onClick={() => handlePayWithQris(unpaidDeliveredOrders.map(o => o.id))}
                  disabled={isPayingAll}
                  style={{ padding: '12px', background: isPayingAll ? '#ccc' : theme.gradientSuccess, color: 'white', border: 'none', borderRadius: '10px', fontSize: '14px', fontWeight: 'bold', cursor: isPayingAll ? 'not-allowed' : 'pointer' }}
                >
                  {isPayingAll ? 'Loading...' : 'Pay via QRIS'}
                </button>
                <button
                  onClick={() => setShowBankTransfer(true)}
                  style={{ padding: '12px', background: 'white', color: theme.primary, border: `2px solid ${theme.primary}`, borderRadius: '10px', fontSize: '14px', fontWeight: 'bold', cursor: 'pointer' }}
                >
                  Bank Transfer
                </button>
              </div>
            )}
          </div>
        )}

        {/* Summary banner — pre_pay: per-product voucher breakdown */}
        {!isLaterPay && productVouchers.length > 0 && (
          <div style={{ background: 'white', borderRadius: '16px', padding: '16px 20px', marginBottom: '16px', boxShadow: '0 4px 20px rgba(0,0,0,0.15)' }}>
            <p style={{ margin: '0 0 10px 0', fontSize: '11px', color: theme.textMuted, fontWeight: '600' }}>🎫 Voucher Balance</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {productVouchers.map(row => (
                <div key={row.product_id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderLeft: `4px solid ${theme.primary}`, paddingLeft: '12px' }}>
                  <span style={{ fontSize: '13px', color: theme.text }}>{row.products?.name ?? '—'}</span>
                  <span style={{ fontSize: '18px', fontWeight: 'bold', color: theme.primary }}>{row.balance}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Order list */}
        {loading ? (
          <div style={{ background: 'white', borderRadius: '20px', padding: '60px', textAlign: 'center' }}>
            <div style={{ width: '50px', height: '50px', border: '4px solid #f3f3f3', borderTop: `4px solid ${theme.primary}`, borderRadius: '50%', margin: '0 auto 20px', animation: 'spin 1s linear infinite' }} />
            <p style={{ color: '#666' }}>Loading orders...</p>
            <style>{`@keyframes spin{0%{transform:rotate(0deg)}100%{transform:rotate(360deg)}}`}</style>
          </div>
        ) : error ? (
          <div style={{ background: 'white', borderRadius: '20px', padding: '40px', textAlign: 'center' }}>
            <p style={{ fontSize: '48px', margin: '0 0 20px 0' }}>⚠️</p>
            <p style={{ color: '#666', marginBottom: '20px' }}>{error}</p>
            <button onClick={fetchOrders} style={{ padding: '12px 30px', background: theme.gradientPrimary, color: 'white', border: 'none', borderRadius: '8px', fontSize: '16px', fontWeight: 'bold', cursor: 'pointer' }}>Try Again</button>
          </div>
        ) : orders.length === 0 ? (
          <div style={{ background: 'white', borderRadius: '20px', padding: '60px', textAlign: 'center' }}>
            <p style={{ fontSize: '64px', margin: '0 0 20px 0' }}>📦</p>
            <h2 style={{ fontSize: '24px', marginBottom: '15px' }}>No Orders Yet</h2>
            <button onClick={() => navigate('/place-order')} style={{ padding: '12px 30px', background: theme.gradientPrimary, color: 'white', border: 'none', borderRadius: '8px', fontSize: '16px', fontWeight: 'bold', cursor: 'pointer' }}>🛒 New Order</button>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            {orders.map((order) => (
              <div key={order.id} style={{ background: 'white', borderRadius: '16px', padding: '20px', boxShadow: '0 4px 20px rgba(0,0,0,0.12)' }}>

                {/* Status + date */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                  <span style={{ background: getStatusColor(order.status), color: 'white', padding: '4px 12px', borderRadius: '20px', fontSize: '12px', fontWeight: 'bold' }}>
                    {getStatusIcon(order.status)} {order.status.toUpperCase()}
                  </span>
                  <span style={{ fontSize: '12px', color: theme.textMuted }}>🗓️ {formatDate(order.delivery_date)}</span>
                </div>

                {/* Amount + payment status */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                  <span style={{ fontSize: '18px', fontWeight: 'bold', color: theme.text }}>{formatCurrency(order.total_amount)}</span>
                  <span style={{ fontSize: '13px', fontWeight: '600', color: order.payment_status === 'paid' ? theme.success : theme.error }}>
                    {order.payment_status === 'paid' ? '✅ Paid' : '⏳ Unpaid'}
                  </span>
                </div>

                <p style={{ fontSize: '12px', color: theme.textMuted, margin: '0 0 12px 0' }}>
                  Order #{order.id.slice(0, 8)} · {formatDate(order.created_at)}
                </p>

                {/* Buttons */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {order.status === 'pending' ? (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                      <button onClick={() => navigate(`/place-order?edit=${order.id}`)} style={{ padding: '10px', background: theme.info, color: 'white', border: 'none', borderRadius: '8px', fontSize: '14px', fontWeight: 'bold', cursor: 'pointer' }}>
                        ✏️ Edit
                      </button>
                      <button onClick={() => handleCancel(order.id)} disabled={cancellingId === order.id} style={{ padding: '10px', background: cancellingId === order.id ? '#ccc' : theme.error, color: 'white', border: 'none', borderRadius: '8px', fontSize: '14px', fontWeight: 'bold', cursor: cancellingId === order.id ? 'not-allowed' : 'pointer' }}>
                        {cancellingId === order.id ? '...' : '🗑️ Cancel'}
                      </button>
                    </div>
                  ) : order.status === 'scheduled' ? (
                    <div style={{ padding: '8px 12px', background: '#f5f5f5', borderRadius: '8px', fontSize: '12px', color: theme.textMuted, textAlign: 'center' }}>
                      ℹ️ Order confirmed — cannot be edited or cancelled
                    </div>
                  ) : null}

                  {/* View payment evidence */}
                  {order.payment_evidence && (
                    <button
                      onClick={() => handleViewPaymentEvidence(order)}
                      disabled={loadingEvidenceId === order.id}
                      style={{ padding: '10px', background: '#f0fbfb', color: theme.primary, border: `2px solid ${theme.primary}`, borderRadius: '8px', fontSize: '14px', fontWeight: 'bold', cursor: 'pointer' }}
                    >
                      {loadingEvidenceId === order.id ? '...' : '🧾 View Payment Receipt'}
                    </button>
                  )}

                  {/* View Delivery Details */}
                  <button
                    onClick={() => navigate(`/orders/${order.id}/delivery`)}
                    style={{ padding: '10px', background: theme.gradientPrimary, color: 'white', border: 'none', borderRadius: '8px', fontSize: '14px', fontWeight: 'bold', cursor: 'pointer', transition: 'transform 0.2s' }}
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
                <p style={{ margin: 0, fontWeight: '700', fontSize: '16px' }}>Bank Transfer</p>
                <p style={{ margin: 0, fontSize: '13px', color: theme.textMuted }}>
                  {unpaidDeliveredOrders.length} order(s) · {formatCurrency(totalUnpaid)}
                </p>
              </div>
              <button onClick={closeUploadModal} style={{ background: 'none', border: 'none', fontSize: '22px', cursor: 'pointer', color: theme.textMuted }}>✕</button>
            </div>

            <div style={{ padding: '20px' }}>
              {/* Bank info */}
              <div style={{ background: '#f5f5f5', borderRadius: '12px', padding: '20px', marginBottom: '16px' }}>
                <p style={{ margin: '0 0 8px 0', fontSize: '13px', color: theme.textMuted }}>Bank</p>
                <p style={{ margin: '0 0 16px 0', fontSize: '20px', fontWeight: 'bold', color: theme.text }}>{BANK_INFO.bank}</p>
                <p style={{ margin: '0 0 8px 0', fontSize: '13px', color: theme.textMuted }}>Account Number</p>
                <p style={{ margin: '0 0 16px 0', fontSize: '24px', fontWeight: 'bold', letterSpacing: '2px', color: theme.primary }}>{BANK_INFO.account}</p>
                <p style={{ margin: '0 0 8px 0', fontSize: '13px', color: theme.textMuted }}>Account Name</p>
                <p style={{ margin: 0, fontSize: '14px', fontWeight: '600', color: theme.text }}>{BANK_INFO.name}</p>
              </div>
              <p style={{ fontSize: '13px', color: theme.error, fontWeight: '700', textAlign: 'center', marginBottom: '20px', background: '#fff3e0', padding: '10px', borderRadius: '8px' }}>
                Transfer amount: {formatCurrency(totalUnpaid)}
                {unpaidDeliveredOrders.length > 1 && ` (${unpaidDeliveredOrders.length} orders)`}
              </p>

              {/* Upload evidence */}
              <div style={{ borderTop: '1px solid #eee', paddingTop: '20px' }}>
                <p style={{ fontWeight: '600', fontSize: '14px', margin: '0 0 12px 0' }}>📎 Upload Payment Receipt</p>
                {uploadSuccess ? (
                  <div style={{ background: '#e8f5e9', border: `2px solid ${theme.success}`, borderRadius: '12px', padding: '16px', textAlign: 'center' }}>
                    <p style={{ margin: 0, color: theme.success, fontWeight: '600' }}>✅ Receipt uploaded successfully!</p>
                    <p style={{ margin: '8px 0 0', fontSize: '13px', color: theme.textMuted }}>We will confirm your payment shortly.</p>
                  </div>
                ) : (
                  <>
                    {previewUrl && (
                      <img src={previewUrl} alt="Preview" style={{ width: '100%', borderRadius: '10px', marginBottom: '12px', maxHeight: '200px', objectFit: 'cover' }} />
                    )}
                    <input ref={fileInputRef} type="file" accept="image/*" onChange={handleFileSelect} style={{ display: 'none' }} />
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      style={{ width: '100%', padding: '12px', background: '#f5f5f5', color: theme.text, border: '2px dashed #ccc', borderRadius: '10px', fontSize: '14px', cursor: 'pointer', marginBottom: '10px' }}
                    >
                      {selectedFile ? `📄 ${selectedFile.name}` : '📷 Select Photo'}
                    </button>
                    {selectedFile && (
                      <button
                        onClick={handleUploadEvidence}
                        disabled={uploading}
                        style={{ width: '100%', padding: '14px', background: uploading ? '#ccc' : theme.gradientPrimary, color: 'white', border: 'none', borderRadius: '10px', fontSize: '15px', fontWeight: 'bold', cursor: uploading ? 'not-allowed' : 'pointer' }}
                      >
                        {uploading ? 'Uploading...' : '⬆️ Submit Receipt'}
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
              <span style={{ fontWeight: '600' }}>🧾 Payment Receipt</span>
              <button onClick={() => setPaymentEvidenceUrl(null)} style={{ background: 'none', border: 'none', fontSize: '20px', cursor: 'pointer' }}>✕</button>
            </div>
            <img src={paymentEvidenceUrl} alt="Payment receipt" style={{ width: '100%', display: 'block', maxHeight: '70vh', objectFit: 'contain' }} />
          </div>
        </div>
      )}

      <BottomNav customer={customer} />
    </div>
  );
}
