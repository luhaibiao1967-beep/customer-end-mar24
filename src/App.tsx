// src/App.tsx - Using localStorage for auth (no Supabase Auth needed!)
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { useState, useEffect } from 'react';
import CustomerLogin from './Pages/CustomerLogin';
import CustomerRegister from './Pages/CustomerRegister';
import CustomerHome from './Pages/CustomerHome';
import BuyVouchers from './Pages/BuyVouchers';
import OrderHistory from './Pages/OrderHistory';
import PlaceOrder from './Pages/PlaceOrder';

function App() {
  const [loading, setLoading] = useState(true);
  const [customer, setCustomer] = useState<any>(null);

  useEffect(() => {
    // Check localStorage for session
    const isLoggedIn = localStorage.getItem('isLoggedIn');
    const customerData = localStorage.getItem('customer');

    if (isLoggedIn === 'true' && customerData) {
      try {
        const parsedCustomer = JSON.parse(customerData);
        setCustomer(parsedCustomer);
      } catch (err) {
        console.error('Failed to parse customer data:', err);
        localStorage.removeItem('customer');
        localStorage.removeItem('isLoggedIn');
      }
    }

    setLoading(false);
  }, []);

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
        <Route path="/login" element={customer ? <Navigate to="/" replace /> : <CustomerLogin />} />
        <Route path="/register" element={customer ? <Navigate to="/" replace /> : <CustomerRegister />} />

        {/* Protected routes */}
        <Route
          path="/"
          element={
            customer ? (
              <CustomerHome customer={customer} />
            ) : (
              <Navigate to="/login" replace />
            )
          }
        />
        <Route
          path="/buy-vouchers"
          element={
            customer ? (
              <BuyVouchers customer={customer} />
            ) : (
              <Navigate to="/login" replace />
            )
          }
        />
        <Route
          path="/place-order"
          element={
            customer ? (
              <PlaceOrder customer={customer} />
            ) : (
              <Navigate to="/login" replace />
            )
          }
        />
        <Route
          path="/orders"
          element={
            customer ? (
              <OrderHistory customer={customer} />
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
