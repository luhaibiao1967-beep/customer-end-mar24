// src/Pages/OrderHistory.tsx - View order history
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../supabaseClient';

interface Customer {
  id: string;
  name: string;
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
}

interface OrderHistoryProps {
  customer: Customer;
}

export default function OrderHistory({ customer }: OrderHistoryProps) {
  const navigate = useNavigate();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchOrders();
  }, [customer.id]);

  const fetchOrders = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('orders')
        .select('*')
        .eq('customer_id', customer.id)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setOrders(data || []);
    } catch (err: any) {
      console.error('Error fetching orders:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const getStatusColor = (status: string): string => {
    switch (status) {
      case 'pending':
        return '#ffc107';
      case 'in_progress':
        return '#2196f3';
      case 'delivered':
        return '#28a745';
      case 'cancelled':
        return '#dc3545';
      default:
        return '#999';
    }
  };

  const getStatusIcon = (status: string): string => {
    switch (status) {
      case 'pending':
        return '⏳';
      case 'in_progress':
        return '🚚';
      case 'delivered':
        return '✅';
      case 'cancelled':
        return '❌';
      default:
        return '📦';
    }
  };

  const formatCurrency = (amount: number): string => {
    return new Intl.NumberFormat('id-ID', {
      style: 'currency',
      currency: 'IDR',
      minimumFractionDigits: 0,
    }).format(amount);
  };

  const formatDate = (dateString: string): string => {
    return new Date(dateString).toLocaleDateString('id-ID', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
      padding: '20px'
    }}>
      {/* Header */}
      <div style={{
        maxWidth: '1200px',
        margin: '0 auto 30px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center'
      }}>
        <button
          onClick={() => navigate('/')}
          style={{
            padding: '10px 20px',
            background: 'rgba(255,255,255,0.2)',
            color: 'white',
            border: '2px solid white',
            borderRadius: '8px',
            fontSize: '14px',
            fontWeight: 'bold',
            cursor: 'pointer'
          }}
        >
          ← Back
        </button>
        <h1 style={{ color: 'white', fontSize: '24px', margin: 0 }}>
          📦 Order History
        </h1>
        <div style={{ width: '100px' }} />
      </div>

      {/* Content */}
      <div style={{
        maxWidth: '1200px',
        margin: '0 auto'
      }}>
        {loading ? (
          <div style={{
            background: 'white',
            borderRadius: '20px',
            padding: '60px',
            textAlign: 'center',
            boxShadow: '0 10px 40px rgba(0,0,0,0.2)'
          }}>
            <div style={{
              width: '50px',
              height: '50px',
              border: '4px solid #f3f3f3',
              borderTop: '4px solid #667eea',
              borderRadius: '50%',
              margin: '0 auto 20px',
              animation: 'spin 1s linear infinite'
            }} />
            <p style={{ color: '#666' }}>Loading orders...</p>
            <style>{`
              @keyframes spin {
                0% { transform: rotate(0deg); }
                100% { transform: rotate(360deg); }
              }
            `}</style>
          </div>
        ) : error ? (
          <div style={{
            background: 'white',
            borderRadius: '20px',
            padding: '40px',
            textAlign: 'center',
            boxShadow: '0 10px 40px rgba(0,0,0,0.2)'
          }}>
            <p style={{ fontSize: '48px', margin: '0 0 20px 0' }}>⚠️</p>
            <h2 style={{ fontSize: '24px', marginBottom: '10px' }}>Error Loading Orders</h2>
            <p style={{ color: '#666', marginBottom: '20px' }}>{error}</p>
            <button
              onClick={fetchOrders}
              style={{
                padding: '12px 30px',
                background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                color: 'white',
                border: 'none',
                borderRadius: '8px',
                fontSize: '16px',
                fontWeight: 'bold',
                cursor: 'pointer'
              }}
            >
              Try Again
            </button>
          </div>
        ) : orders.length === 0 ? (
          <div style={{
            background: 'white',
            borderRadius: '20px',
            padding: '60px',
            textAlign: 'center',
            boxShadow: '0 10px 40px rgba(0,0,0,0.2)'
          }}>
            <p style={{ fontSize: '64px', margin: '0 0 20px 0' }}>📦</p>
            <h2 style={{ fontSize: '24px', marginBottom: '15px' }}>No Orders Yet</h2>
            <p style={{ color: '#666', marginBottom: '30px' }}>
              You haven't placed any orders yet.<br />
              Start ordering to see your history here!
            </p>
            <button
              onClick={() => navigate('/')}
              style={{
                padding: '12px 30px',
                background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                color: 'white',
                border: 'none',
                borderRadius: '8px',
                fontSize: '16px',
                fontWeight: 'bold',
                cursor: 'pointer'
              }}
            >
              🛒 Start Ordering
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
            {orders.map((order) => (
              <div
                key={order.id}
                style={{
                  background: 'white',
                  borderRadius: '15px',
                  padding: '25px',
                  boxShadow: '0 5px 20px rgba(0,0,0,0.1)',
                  position: 'relative'
                }}
              >
                {/* Status Badge */}
                <div style={{
                  position: 'absolute',
                  top: '20px',
                  right: '20px',
                  background: getStatusColor(order.status),
                  color: 'white',
                  padding: '8px 16px',
                  borderRadius: '20px',
                  fontSize: '12px',
                  fontWeight: 'bold',
                  textTransform: 'uppercase'
                }}>
                  {getStatusIcon(order.status)} {order.status.replace('_', ' ')}
                </div>

                {/* Order Info */}
                <div style={{ paddingRight: '150px' }}>
                  <p style={{ fontSize: '12px', color: '#999', margin: '0 0 5px 0' }}>
                    Order #{order.id.slice(0, 8)}
                  </p>
                  <h3 style={{ fontSize: '18px', margin: '0 0 10px 0' }}>
                    {order.customer_name}
                  </h3>
                  <p style={{ fontSize: '14px', color: '#666', margin: '0 0 15px 0' }}>
                    📍 {order.customer_address}
                  </p>

                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr 1fr',
                    gap: '15px',
                    marginBottom: '15px'
                  }}>
                    <div>
                      <p style={{ fontSize: '12px', color: '#999', margin: '0 0 5px 0' }}>
                        Delivery Date
                      </p>
                      <p style={{ fontSize: '14px', fontWeight: '500', margin: 0 }}>
                        🗓️ {formatDate(order.delivery_date)}
                      </p>
                    </div>
                    <div>
                      <p style={{ fontSize: '12px', color: '#999', margin: '0 0 5px 0' }}>
                        Total Amount
                      </p>
                      <p style={{ fontSize: '14px', fontWeight: '500', margin: 0 }}>
                        💰 {formatCurrency(order.total_amount)}
                      </p>
                    </div>
                    <div>
                      <p style={{ fontSize: '12px', color: '#999', margin: '0 0 5px 0' }}>
                        Payment Status
                      </p>
                      <p style={{
                        fontSize: '14px',
                        fontWeight: '500',
                        margin: 0,
                        color: order.payment_status === 'paid' ? '#28a745' : '#dc3545'
                      }}>
                        {order.payment_status === 'paid' ? '✅ Paid' : '⏳ Unpaid'}
                      </p>
                    </div>
                  </div>

                  <p style={{ fontSize: '12px', color: '#999', margin: 0 }}>
                    Ordered on {formatDate(order.created_at)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
