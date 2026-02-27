// src/Pages/OrderHistory.tsx - View order history
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import BottomNav from '../Components/BottomNav';
import { theme } from '../theme';

const SUPABASE_URL = 'https://jzdnvdebwmuebjbergsp.supabase.co';

interface Customer {
  id: string;
  name: string;
  customer_type: string;
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
  borrowed_gallons?: number;
}

interface OrderHistoryProps {
  customer: Customer;
}

export default function OrderHistory({ customer }: OrderHistoryProps) {
  const navigate = useNavigate();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [evidenceUrl, setEvidenceUrl] = useState<string | null>(null);
  const [initialBorrowedGallons, setInitialBorrowedGallons] = useState(0);

  useEffect(() => {
    fetchOrders();
  }, [customer.id]);

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
      console.error('Error fetching orders:', err);
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
      alert('Cancel failed: ' + err.message);
    } finally {
      setCancellingId(null);
    }
  };

  const getDeliveryEvidenceUrl = (path: string) =>
    `${SUPABASE_URL}/storage/v1/object/public/delivery-evidence/${path}`;

  // Total unpaid amount across all unpaid orders
  const totalUnpaid = orders
    .filter(o => o.payment_status === 'unpaid' && o.status === 'delivered')
    .reduce((sum, o) => sum + o.total_amount, 0);

  const totalBorrowedGallons = initialBorrowedGallons +
    orders.reduce((sum, o) => sum + (o.borrowed_gallons || 0), 0);

  const getStatusColor = (status: string): string => {
    switch (status) {
      case 'pending': return theme.warning;
      case 'scheduled': return theme.info;
      case 'delivered': return theme.success;
      default: return '#999';
    }
  };

  const getStatusIcon = (status: string): string => {
    switch (status) {
      case 'pending': return '⏳';
      case 'scheduled': return '📅';
      case 'delivered': return '✅';
      default: return '📦';
    }
  };

  const formatCurrency = (amount: number): string =>
    new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(amount);

  const formatDate = (dateString: string): string =>
    new Date(dateString).toLocaleDateString('id-ID', { year: 'numeric', month: 'long', day: 'numeric' });

  return (
    <div style={{ minHeight: '100vh', background: theme.gradientPrimary, padding: '20px', paddingBottom: '80px' }}>

      {/* Header */}
      <div style={{ maxWidth: '800px', margin: '0 auto 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <button
          onClick={() => navigate('/customer-home')}
          style={{ padding: '10px 20px', background: 'rgba(255,255,255,0.2)', color: 'white', border: '2px solid white', borderRadius: '8px', fontSize: '14px', fontWeight: 'bold', cursor: 'pointer' }}
        >
          ← Back
        </button>
        <h1 style={{ color: 'white', fontSize: '22px', margin: 0 }}>📦 My Orders</h1>
        <div style={{ width: '80px' }} />
      </div>

      <div style={{ maxWidth: '800px', margin: '0 auto' }}>

        {/* Summary banner — unpaid balance + borrowed gallons */}
        {customer.customer_type !== 'pre_pay' && (totalUnpaid > 0 || totalBorrowedGallons > 0) && (
          <div style={{
            background: 'white',
            borderRadius: '16px',
            padding: '16px 20px',
            marginBottom: '16px',
            boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: '12px',
          }}>
            {/* Outstanding balance */}
            <div style={{ borderLeft: `4px solid ${theme.error}`, paddingLeft: '12px' }}>
              <p style={{ margin: 0, fontSize: '11px', color: theme.textMuted }}>Outstanding Balance</p>
              <p style={{ margin: '4px 0 0', fontSize: '18px', fontWeight: 'bold', color: totalUnpaid > 0 ? theme.error : theme.success }}>
                {totalUnpaid > 0 ? formatCurrency(totalUnpaid) : '✅ Clear'}
              </p>
            </div>
            {/* Borrowed gallons */}
            <div style={{ borderLeft: `4px solid ${theme.primary}`, paddingLeft: '12px' }}>
              <p style={{ margin: 0, fontSize: '11px', color: theme.textMuted }}>Borrowed Gallons</p>
              <p style={{ margin: '4px 0 0', fontSize: '18px', fontWeight: 'bold', color: theme.primary }}>
                {totalBorrowedGallons} gallons
              </p>
            </div>
          </div>
        )}

        {/* Content */}
        {loading ? (
          <div style={{ background: 'white', borderRadius: '20px', padding: '60px', textAlign: 'center', boxShadow: '0 10px 40px rgba(0,0,0,0.2)' }}>
            <div style={{ width: '50px', height: '50px', border: '4px solid #f3f3f3', borderTop: `4px solid ${theme.primary}`, borderRadius: '50%', margin: '0 auto 20px', animation: 'spin 1s linear infinite' }} />
            <p style={{ color: '#666' }}>Loading orders...</p>
            <style>{`@keyframes spin { 0%{transform:rotate(0deg)} 100%{transform:rotate(360deg)} }`}</style>
          </div>
        ) : error ? (
          <div style={{ background: 'white', borderRadius: '20px', padding: '40px', textAlign: 'center', boxShadow: '0 10px 40px rgba(0,0,0,0.2)' }}>
            <p style={{ fontSize: '48px', margin: '0 0 20px 0' }}>⚠️</p>
            <h2 style={{ fontSize: '24px', marginBottom: '10px' }}>Error Loading Orders</h2>
            <p style={{ color: '#666', marginBottom: '20px' }}>{error}</p>
            <button onClick={fetchOrders} style={{ padding: '12px 30px', background: theme.gradientPrimary, color: 'white', border: 'none', borderRadius: '8px', fontSize: '16px', fontWeight: 'bold', cursor: 'pointer' }}>
              Try Again
            </button>
          </div>
        ) : orders.length === 0 ? (
          <div style={{ background: 'white', borderRadius: '20px', padding: '60px', textAlign: 'center', boxShadow: '0 10px 40px rgba(0,0,0,0.2)' }}>
            <p style={{ fontSize: '64px', margin: '0 0 20px 0' }}>📦</p>
            <h2 style={{ fontSize: '24px', marginBottom: '15px' }}>No Orders Yet</h2>
            <p style={{ color: '#666', marginBottom: '30px' }}>You haven't placed any orders yet.</p>
            <button onClick={() => navigate('/place-order')} style={{ padding: '12px 30px', background: theme.gradientPrimary, color: 'white', border: 'none', borderRadius: '8px', fontSize: '16px', fontWeight: 'bold', cursor: 'pointer' }}>
              🛒 New Order
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            {orders.map((order) => (
              <div key={order.id} style={{ background: 'white', borderRadius: '16px', padding: '20px', boxShadow: '0 4px 20px rgba(0,0,0,0.12)' }}>

                {/* Top row: status badge + date */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                  <span style={{ background: getStatusColor(order.status), color: 'white', padding: '4px 12px', borderRadius: '20px', fontSize: '12px', fontWeight: 'bold' }}>
                    {getStatusIcon(order.status)} {order.status.toUpperCase()}
                  </span>
                  <span style={{ fontSize: '12px', color: theme.textMuted }}>
                    🗓️ {formatDate(order.delivery_date)}
                  </span>
                </div>

                {/* Amount + payment status */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                  <span style={{ fontSize: '18px', fontWeight: 'bold', color: theme.text }}>
                    {formatCurrency(order.total_amount)}
                  </span>
                  <span style={{ fontSize: '13px', fontWeight: '600', color: order.payment_status === 'paid' ? theme.success : theme.error }}>
                    {order.payment_status === 'paid' ? '✅ Paid' : '⏳ Unpaid'}
                  </span>
                </div>

                <p style={{ fontSize: '12px', color: theme.textMuted, margin: '0 0 12px 0' }}>
                  Order #{order.id.slice(0, 8)} · {formatDate(order.created_at)}
                </p>

                {/* Action buttons */}
                {order.status === 'pending' ? (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                    <button
                      onClick={() => navigate(`/place-order?edit=${order.id}`)}
                      style={{ padding: '10px', background: theme.info, color: 'white', border: 'none', borderRadius: '8px', fontSize: '14px', fontWeight: 'bold', cursor: 'pointer' }}
                    >
                      ✏️ Edit
                    </button>
                    <button
                      onClick={() => handleCancel(order.id)}
                      disabled={cancellingId === order.id}
                      style={{ padding: '10px', background: cancellingId === order.id ? '#ccc' : theme.error, color: 'white', border: 'none', borderRadius: '8px', fontSize: '14px', fontWeight: 'bold', cursor: cancellingId === order.id ? 'not-allowed' : 'pointer' }}
                    >
                      {cancellingId === order.id ? '...' : '🗑️ Cancel'}
                    </button>
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <div style={{ padding: '8px 12px', background: '#f5f5f5', borderRadius: '8px', fontSize: '12px', color: theme.textMuted, textAlign: 'center' }}>
                      ℹ️ Order confirmed — cannot be edited or cancelled
                    </div>
                    {/* Delivery evidence button */}
                    {order.delivery_evidence && (
                      <button
                        onClick={() => setEvidenceUrl(getDeliveryEvidenceUrl(order.delivery_evidence!))}
                        style={{ padding: '10px', background: theme.gradientPrimary, color: 'white', border: 'none', borderRadius: '8px', fontSize: '14px', fontWeight: 'bold', cursor: 'pointer' }}
                      >
                        📷 View Delivery Photo
                      </button>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Delivery evidence modal */}
      {evidenceUrl && (
        <div
          onClick={() => setEvidenceUrl(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000, padding: '20px' }}
        >
          <div onClick={e => e.stopPropagation()} style={{ background: 'white', borderRadius: '16px', overflow: 'hidden', maxWidth: '500px', width: '100%' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 16px', borderBottom: '1px solid #eee' }}>
              <span style={{ fontWeight: '600', fontSize: '15px' }}>📷 Delivery Photo</span>
              <button onClick={() => setEvidenceUrl(null)} style={{ background: 'none', border: 'none', fontSize: '20px', cursor: 'pointer', color: theme.textMuted }}>✕</button>
            </div>
            <img
              src={evidenceUrl}
              alt="Delivery evidence"
              style={{ width: '100%', display: 'block', maxHeight: '70vh', objectFit: 'contain' }}
            />
          </div>
        </div>
      )}

      <BottomNav customer={customer} />
    </div>
  );
}
