// src/App.tsx - Updated with register route
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { supabase } from './supabaseClient';
import CustomerLogin from './Pages/CustomerLogin';
import CustomerRegister from './Pages/CustomerRegister';

function App() {
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<any>(null);
  const [customer, setCustomer] = useState<any>(null);

  useEffect(() => {
    // Check active session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if (session?.user) {
        loadCustomerProfile(session.user.id);
      } else {
        setLoading(false);
      }
    });

    // Listen for auth changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      if (session?.user) {
        loadCustomerProfile(session.user.id);
      } else {
        setCustomer(null);
        setLoading(false);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const loadCustomerProfile = async (userId: string) => {
    try {
      const { data, error } = await supabase
        .from('customers')
        .select('*')
        .eq('auth_user_id', userId)
        .single();

      if (error || !data) {
        console.error('Customer profile error:', error);
        setCustomer(null);
      } else {
        setCustomer(data);
      }
    } catch (err) {
      console.error('Error loading customer profile:', err);
      setCustomer(null);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)'
      }}>
        <div style={{ textAlign: 'center', color: 'white' }}>
          <div style={{
            width: '50px',
            height: '50px',
            border: '4px solid rgba(255,255,255,0.3)',
            borderTop: '4px solid white',
            borderRadius: '50%',
            margin: '0 auto 20px',
            animation: 'spin 1s linear infinite'
          }} />
          <p>Loading...</p>
          <style>{`
            @keyframes spin {
              0% { transform: rotate(0deg); }
              100% { transform: rotate(360deg); }
            }
          `}</style>
        </div>
      </div>
    );
  }

  return (
    <Router>
      <Routes>
        {/* Public routes */}
        <Route path="/login" element={<CustomerLogin />} />
        <Route path="/register" element={<CustomerRegister />} />

        {/* Protected route - Home */}
        <Route
          path="/"
          element={
            session && customer ? (
              <div style={{
                minHeight: '100vh',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                padding: '20px'
              }}>
                <div style={{
                  background: 'white',
                  borderRadius: '20px',
                  padding: '40px',
                  maxWidth: '600px',
                  width: '100%',
                  boxShadow: '0 20px 60px rgba(0,0,0,0.3)'
                }}>
                  {/* Welcome Header */}
                  <div style={{ textAlign: 'center', marginBottom: '30px' }}>
                    <div style={{
                      width: '100px',
                      height: '100px',
                      background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                      borderRadius: '50%',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      margin: '0 auto 20px',
                      fontSize: '50px'
                    }}>
                      🎉
                    </div>
                    <h1 style={{ fontSize: '32px', margin: '0 0 10px 0' }}>
                      Welcome, {customer.name}!
                    </h1>
                    <p style={{ color: '#666', margin: 0 }}>
                      Your account is ready
                    </p>
                  </div>

                  {/* Customer Info Cards */}
                  <div style={{ marginBottom: '30px' }}>
                    <div style={{
                      background: '#f5f5f5',
                      padding: '20px',
                      borderRadius: '12px',
                      marginBottom: '15px'
                    }}>
                      <p style={{ fontSize: '14px', color: '#999', margin: '0 0 5px 0' }}>📍 Address</p>
                      <p style={{ fontSize: '16px', color: '#333', margin: 0, fontWeight: '500' }}>
                        {customer.addr}
                      </p>
                    </div>

                    <div style={{
                      background: '#f5f5f5',
                      padding: '20px',
                      borderRadius: '12px',
                      marginBottom: '15px'
                    }}>
                      <p style={{ fontSize: '14px', color: '#999', margin: '0 0 5px 0' }}>💬 WhatsApp</p>
                      <p style={{ fontSize: '16px', color: '#333', margin: 0, fontWeight: '500' }}>
                        {customer.whatsapp}
                      </p>
                    </div>

                    <div style={{
                      background: '#f5f5f5',
                      padding: '20px',
                      borderRadius: '12px',
                      marginBottom: '15px'
                    }}>
                      <p style={{ fontSize: '14px', color: '#999', margin: '0 0 5px 0' }}>👤 Account Type</p>
                      <p style={{ fontSize: '16px', color: '#333', margin: 0, fontWeight: '500' }}>
                        {customer.customer_type === 'pre_pay' ? '💳 Prepaid (Voucher)' : '📄 Postpaid (Invoice)'}
                      </p>
                    </div>

                    <div style={{
                      background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                      padding: '25px',
                      borderRadius: '12px',
                      textAlign: 'center',
                      color: 'white'
                    }}>
                      <p style={{ fontSize: '14px', margin: '0 0 10px 0', opacity: 0.9 }}>
                        Voucher Balance
                      </p>
                      <p style={{ fontSize: '48px', fontWeight: 'bold', margin: 0 }}>
                        {customer.voucher_balance}
                      </p>
                      <p style={{ fontSize: '14px', margin: '10px 0 0 0', opacity: 0.9 }}>
                        vouchers available
                      </p>
                    </div>
                  </div>

                  {/* Branch Status */}
                  {!customer.branch ? (
                    <div style={{
                      background: '#fff3cd',
                      border: '1px solid #ffc107',
                      borderRadius: '12px',
                      padding: '20px',
                      marginBottom: '20px',
                      textAlign: 'center'
                    }}>
                      <p style={{ fontSize: '24px', margin: '0 0 10px 0' }}>⏳</p>
                      <p style={{ fontSize: '16px', fontWeight: 'bold', margin: '0 0 10px 0', color: '#856404' }}>
                        Branch Assignment Pending
                      </p>
                      <p style={{ fontSize: '14px', margin: 0, color: '#856404' }}>
                        Our team will assign your delivery area soon. You'll be notified via WhatsApp.
                      </p>
                    </div>
                  ) : (
                    <div style={{
                      background: '#d4edda',
                      border: '1px solid #28a745',
                      borderRadius: '12px',
                      padding: '20px',
                      marginBottom: '20px',
                      textAlign: 'center'
                    }}>
                      <p style={{ fontSize: '24px', margin: '0 0 10px 0' }}>✅</p>
                      <p style={{ fontSize: '16px', fontWeight: 'bold', margin: '0 0 5px 0', color: '#155724' }}>
                        Delivery Area Assigned
                      </p>
                      <p style={{ fontSize: '18px', margin: 0, color: '#155724' }}>
                        📍 {customer.branch}
                      </p>
                    </div>
                  )}

                  {/* Action Buttons */}
                  <div style={{ display: 'flex', gap: '10px' }}>
                    <button
                      onClick={() => alert('Order page coming soon!')}
                      disabled={!customer.branch}
                      style={{
                        flex: 1,
                        padding: '14px',
                        background: customer.branch ? 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' : '#ccc',
                        color: 'white',
                        border: 'none',
                        borderRadius: '8px',
                        fontSize: '16px',
                        fontWeight: 'bold',
                        cursor: customer.branch ? 'pointer' : 'not-allowed'
                      }}
                    >
                      🛒 Order Now
                    </button>
                    <button
                      onClick={() => supabase.auth.signOut()}
                      style={{
                        flex: 1,
                        padding: '14px',
                        background: '#dc3545',
                        color: 'white',
                        border: 'none',
                        borderRadius: '8px',
                        fontSize: '16px',
                        fontWeight: 'bold',
                        cursor: 'pointer'
                      }}
                    >
                      🚪 Sign Out
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <Navigate to="/login" replace />
            )
          }
        />

        {/* Catch all */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Router>
  );
}

export default App;
