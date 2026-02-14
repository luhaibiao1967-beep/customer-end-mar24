// src/App.tsx - CORRECTED VERSION
// Fixed: sessionStorage, storage event listener

import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { useState, useEffect } from 'react';
import CustomerRegister from './Pages/CustomerRegister';
import CustomerReauth from './Pages/CustomerReauth';
import CustomerHome from './Pages/CustomerHome';
import BuyVouchers from './Pages/BuyVouchers';
import OrderHistory from './Pages/OrderHistory';
import PlaceOrder from './Pages/PlaceOrder';
import MagicLinkHandler from './Components/MagicLinkHandler';

function App() {
  const [loading, setLoading] = useState(true);
  const [customer, setCustomer] = useState<any>(null);

  // Load customer from sessionStorage
  const loadCustomer = () => {
    const isAuthenticated = sessionStorage.getItem('authenticated');
    const customerData = sessionStorage.getItem('customer');

    if (isAuthenticated === 'true' && customerData) {
      try {
        const parsedCustomer = JSON.parse(customerData);
        setCustomer(parsedCustomer);
      } catch (err) {
        console.error('Failed to parse customer data:', err);
        sessionStorage.clear();
      }
    }
  };

  useEffect(() => {
    loadCustomer();
    setLoading(false);

    // Listen for auth updates from MagicLinkHandler
    const handleAuthUpdate = () => {
      loadCustomer();
    };

    window.addEventListener('storage', handleAuthUpdate);
    window.addEventListener('session-auth-updated', handleAuthUpdate);
    
    return () => {
      window.removeEventListener('storage', handleAuthUpdate);
      window.removeEventListener('session-auth-updated', handleAuthUpdate);
    };
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
        {/* Magic Link Route - Validates token and redirects */}
        <Route path="/home" element={<MagicLinkHandler />} />

        {/* Public registration */}
        <Route 
          path="/register" 
          element={customer ? <Navigate to="/customer-home" replace /> : <CustomerRegister />} 
        />

        {/* Re-authentication via OTP */}
        <Route
          path="/reauth"
          element={customer ? <Navigate to="/customer-home" replace /> : <CustomerReauth />}
        />

        {/* Protected routes - require authentication via magic link */}
        <Route
          path="/customer-home"
          element={
            customer ? (
              <CustomerHome customer={customer} />
            ) : (
              <Navigate to="/register" replace />
            )
          }
        />
        <Route
          path="/buy-vouchers"
          element={
            customer ? (
              <BuyVouchers customer={customer} />
            ) : (
              <Navigate to="/register" replace />
            )
          }
        />
        <Route
          path="/place-order"
          element={
            customer ? (
              <PlaceOrder customer={customer} />
            ) : (
              <Navigate to="/register" replace />
            )
          }
        />
        <Route
          path="/orders"
          element={
            customer ? (
              <OrderHistory customer={customer} />
            ) : (
              <Navigate to="/register" replace />
            )
          }
        />

        {/* Root path */}
        <Route
          path="/"
          element={
            customer ? (
              <Navigate to="/customer-home" replace />
            ) : (
              <Navigate to="/register" replace />
            )
          }
        />

        {/* Catch all */}
        <Route path="*" element={<Navigate to="/register" replace />} />
      </Routes>
    </Router>
  );
}

export default App;
