// src/Pages/CustomerHome.tsx - CORRECTED VERSION
// Fixed: customer_type checks, sessionStorage, logout navigation

import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase, SUPABASE_DEBUG } from '../supabaseClient';
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

interface CustomerHomeProps {
  customer: Customer;
}

interface ProductVoucherRow {
  product_id: string;
  balance: number;
  products: { name: string } | null;
}

export default function CustomerHome({ customer }: CustomerHomeProps) {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [pendingOrders, setPendingOrders] = useState<Order[]>([]);
  const [productVouchers, setProductVouchers] = useState<ProductVoucherRow[]>([]);
  const canOrder = customer.branch && customer.branch !== 'Pending';

  useEffect(() => {
    loadPendingOrders();
    if (customer.customer_type === 'pre_pay') loadProductVouchers();
  }, [customer.id]);

  const loadProductVouchers = async () => {
    try {
      const { data } = await supabase
        .from('customer_product_vouchers')
        .select('product_id, balance, products(name)')
        .eq('customer_id', customer.id);
      setProductVouchers((data as ProductVoucherRow[]) || []);
    } catch {
      // silently fail
    }
  };

  const loadPendingOrders = async () => {
    try {
      const { data, error } = await supabase
        .from('orders')
        .select('*')
        .eq('customer_id', customer.id)
        .in('status', ['pending', 'scheduled'])
        .order('created_at', { ascending: false });

      if (error) throw error;
      setPendingOrders(data || []);
    } catch (err) {
      console.error('Error loading orders:', err);
    }
  };

  const handleDeleteOrder = async (orderId: string) => {
    if (!confirm('Are you sure you want to delete this order?')) return;

    try {
      const { error: itemsError } = await supabase
        .from('order_items')
        .delete()
        .eq('order_id', orderId);

      if (itemsError) throw itemsError;

      const { error: orderError } = await supabase
        .from('orders')
        .delete()
        .eq('id', orderId);

      if (orderError) throw orderError;

      alert('Order deleted successfully!');
      loadPendingOrders();
      window.location.reload();
    } catch (err: any) {
      console.error('Error deleting order:', err);
      alert('Failed to delete order: ' + err.message);
    }
  };

  const handleSignOut = () => {
    setLoading(true);
    sessionStorage.removeItem('customer');
    sessionStorage.removeItem('auth_token');
    sessionStorage.removeItem('authenticated');
    window.dispatchEvent(new Event('session-auth-updated'));
    navigate('/', { replace: true });
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

  const getStatusColor = (status: string): string => {
    switch (status) {
      case 'pending':
        return theme.warning;
      case 'scheduled':
        return theme.info;
      default:
        return '#999';
    }
  };

  const getStatusIcon = (status: string): string => {
    switch (status) {
      case 'pending':
        return '⏳';
      case 'scheduled':
        return '📅';
      default:
        return '📦';
    }
  };

  return (
    <div style={{
      minHeight: '100vh',
      background: theme.gradientPrimary,
      padding: '20px',
      paddingBottom: '80px',
    }}>
      {/* Navigation Bar */}
      <div style={{
        maxWidth: '1200px',
        margin: '0 auto 20px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center'
      }}>
        <img src="/logo.png" alt="Water Delivery" style={{ height: '36px', objectFit: 'contain' }} />
        <button
          onClick={handleSignOut}
          disabled={loading}
          style={{
            padding: '10px 20px',
            background: 'rgba(255,255,255,0.2)',
            color: 'white',
            border: '2px solid white',
            borderRadius: '8px',
            fontSize: '14px',
            fontWeight: 'bold',
            cursor: loading ? 'not-allowed' : 'pointer'
          }}
        >
          {loading ? '...' : '🚪 Sign Out'}
        </button>
      </div>

      {/* Main Content */}
      <div style={{
        maxWidth: '800px',
        margin: '0 auto'
      }}>
        {/* Customer Card */}
        <div style={{
          background: 'white',
          borderRadius: '20px',
          padding: '24px',
          marginBottom: '20px',
          boxShadow: '0 10px 40px rgba(0,0,0,0.2)'
        }}>
          <h2 style={{ fontSize: '20px', margin: '0 0 20px 0', fontWeight: '600' }}>
            {customer.name}
          </h2>

          {/* Customer Info - stacked vertically */}
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
            marginBottom: '20px'
          }}>
            {/* Address with Edit */}
            <div style={{
              background: '#f5f5f5',
              padding: '15px',
              borderRadius: '12px'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <p style={{ fontSize: '11px', color: '#999', margin: 0 }}>📍 Delivery Address</p>
                <button
                  onClick={() => {
                    const newAddress = prompt('Enter new address:', customer.address);
                    if (newAddress) {
                      supabase
                        .from('customers')
                        .update({ address: newAddress })
                        .eq('id', customer.id)
                        .then(() => {
                          alert('Address updated!');
                          window.location.reload();
                        });
                    }
                  }}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: theme.primary,
                    fontSize: '11px',
                    cursor: 'pointer',
                    padding: 0
                  }}
                >
                  ✏️
                </button>
              </div>
              <p style={{ fontSize: '13px', color: '#333', margin: 0, fontWeight: '500' }}>
                {customer.address}
              </p>
            </div>

            {/* Branch */}
            <div style={{
              background: '#f5f5f5',
              padding: '15px',
              borderRadius: '12px'
            }}>
              <p style={{ fontSize: '11px', color: '#999', margin: '0 0 8px 0' }}>🏢 Service Branch</p>
              <p style={{ fontSize: '13px', color: '#333', margin: 0, fontWeight: '500' }}>
                {customer.branch === 'Pending' ? 'Pending Setup' : (customer.branch || 'Not assigned')}
              </p>
            </div>

            {/* WhatsApp */}
            <div style={{
              background: '#f5f5f5',
              padding: '15px',
              borderRadius: '12px'
            }}>
              <p style={{ fontSize: '11px', color: '#999', margin: '0 0 8px 0' }}>💬 WhatsApp</p>
              <p style={{ fontSize: '13px', color: '#333', margin: 0, fontWeight: '500' }}>
                {customer.whatsapp}
              </p>
            </div>
          </div>

          {/* Voucher Balance - pre_pay: per-product breakdown */}
          {customer.customer_type === 'pre_pay' && (
            <div style={{ marginBottom: '20px' }}>
              <div style={{ background: theme.gradientPrimary, padding: '16px 20px', borderRadius: '12px', color: 'white' }}>
                <p style={{ fontSize: '12px', margin: '0 0 12px 0', opacity: 0.9, fontWeight: '600' }}>
                  🎫 Voucher Balance
                </p>
                {productVouchers.length === 0 ? (
                  <p style={{ fontSize: '14px', margin: 0, opacity: 0.85 }}>No vouchers yet</p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {productVouchers.map(row => (
                      <div key={row.product_id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontSize: '13px', opacity: 0.9 }}>{row.products?.name ?? '—'}</span>
                        <span style={{ fontSize: '20px', fontWeight: 'bold' }}>{row.balance}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Pending Orders Section */}
          {pendingOrders.length > 0 && (
            <div style={{ marginBottom: '20px' }}>
              <h3 style={{ fontSize: '18px', marginBottom: '15px', color: theme.primary }}>
                📋 Your Pending Orders
              </h3>
              {pendingOrders.map((order) => (
                <div
                  key={order.id}
                  style={{
                    background: '#f8f9fa',
                    borderRadius: '12px',
                    padding: '20px',
                    marginBottom: '15px',
                    border: `2px solid ${getStatusColor(order.status)}`
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: '15px' }}>
                    <div>
                      <p style={{
                        display: 'inline-block',
                        background: getStatusColor(order.status),
                        color: 'white',
                        padding: '4px 12px',
                        borderRadius: '20px',
                        fontSize: '12px',
                        fontWeight: 'bold',
                        margin: '0 0 10px 0'
                      }}>
                        {getStatusIcon(order.status)} {order.status.toUpperCase()}
                      </p>
                      <p style={{ fontSize: '14px', color: '#666', margin: '5px 0' }}>
                        🗓️ Delivery: <strong>{formatDate(order.delivery_date)}</strong>
                      </p>
                        <p style={{ fontSize: '16px', color: theme.success, fontWeight: 'bold', margin: '5px 0' }}>
                        💰 {formatCurrency(order.total_amount)}
                      </p>
                    </div>
                  </div>

                  {/* Action Buttons - Only for pending orders */}
                  {order.status === 'pending' && (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                      <button
                        onClick={() => navigate(`/place-order?edit=${order.id}`)}
                        style={{
                          padding: '10px',
                          background: theme.info,
                          color: 'white',
                          border: 'none',
                          borderRadius: '8px',
                          fontSize: '14px',
                          fontWeight: 'bold',
                          cursor: 'pointer'
                        }}
                      >
                        ✏️ Edit
                      </button>
                      <button
                        onClick={() => handleDeleteOrder(order.id)}
                        style={{
                          padding: '10px',
                          background: theme.error,
                          color: 'white',
                          border: 'none',
                          borderRadius: '8px',
                          fontSize: '14px',
                          fontWeight: 'bold',
                          cursor: 'pointer'
                        }}
                      >
                        🗑️ Delete
                      </button>
                    </div>
                  )}

                  {/* Scheduled message */}
                  {order.status === 'scheduled' && (
                    <div style={{
                      background: '#e3f2fd',
                      padding: '10px',
                      borderRadius: '8px',
                      fontSize: '13px',
                      color: '#1976d2',
                      textAlign: 'center'
                    }}>
                      ℹ️ Order is scheduled - cannot be edited
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Action Buttons - pre_pay (matches water depot schema) */}
          {customer.customer_type === 'pre_pay' ? (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
              <button
                onClick={() => navigate('/place-order')}
                disabled={!canOrder}
                style={{
                  padding: '14px',
                  background: canOrder ? 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' : '#ccc',
                  color: 'white',
                  border: 'none',
                  borderRadius: '8px',
                  fontSize: '16px',
                  fontWeight: 'bold',
                  cursor: canOrder ? 'pointer' : 'not-allowed'
                }}
              >
                🛒 Order Delivery
              </button>
              <button
                onClick={() => navigate('/buy-vouchers')}
                style={{
                  padding: '14px',
                  background: theme.gradientSuccess,
                  color: 'white',
                  border: 'none',
                  borderRadius: '8px',
                  fontSize: '16px',
                  fontWeight: 'bold',
                  cursor: 'pointer'
                }}
              >
                🎫 Buy Vouchers
              </button>
            </div>
          ) : (
            <button
              onClick={() => navigate('/place-order')}
              disabled={!canOrder}
              style={{
                width: '100%',
                padding: '14px',
                background: canOrder ? 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' : '#ccc',
                color: 'white',
                border: 'none',
                borderRadius: '8px',
                fontSize: '16px',
                fontWeight: 'bold',
                cursor: canOrder ? 'pointer' : 'not-allowed'
              }}
            >
              🛒 Order Delivery
            </button>
          )}
        </div>

        {/* Quick Stats - pre_pay (matches water depot schema) */}
        <div style={{
          background: 'white',
          borderRadius: '20px',
          padding: '30px',
          boxShadow: '0 10px 40px rgba(0,0,0,0.2)'
        }}>
          <h3 style={{ fontSize: '20px', marginBottom: '20px' }}>📊 Quick Info</h3>
          
          <div style={{ fontSize: '14px', color: '#666', lineHeight: '1.8' }}>
            <p style={{ margin: '0 0 10px 0' }}>
              <strong>Account Status:</strong> {canOrder ? '✅ Active' : '⏳ Pending Setup'}
            </p>
            <p style={{ margin: '0 0 10px 0' }}>
              <strong>Payment Type:</strong> {customer.customer_type === 'pre_pay' ? 'Prepaid (Voucher)' : 'Postpaid (Invoice)'}
            </p>
            {customer.customer_type === 'pre_pay' && (
              <p style={{ margin: '0 0 10px 0' }}>
                <strong>Vouchers:</strong> {productVouchers.reduce((s, r) => s + r.balance, 0)} total
              </p>
            )}
            <p style={{ margin: '0 0 10px 0' }}>
              <strong>Pending Orders:</strong> {pendingOrders.length}
            </p>
          </div>
        </div>

        {/* 调试：当前连接的 Supabase 项目 */}
        <div style={{
          marginTop: '20px',
          padding: '12px 16px',
          background: 'rgba(0,0,0,0.15)',
          borderRadius: '8px',
          fontSize: '12px',
          color: 'rgba(255,255,255,0.9)',
          fontFamily: 'monospace'
        }}>
          🔧 Supabase: <strong>{SUPABASE_DEBUG.projectRef}</strong>
          {SUPABASE_DEBUG.projectRef !== 'jzdnvdebwmuebjbergsp' && (
            <span style={{ color: '#ffeb3b', marginLeft: '8px' }}>⚠️ 非 water depot 项目</span>
          )}
        </div>
      </div>
      <BottomNav customer={customer} />
    </div>
  );
}
