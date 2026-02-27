// src/App.tsx - CORRECTED VERSION
// Fixed: sessionStorage, storage event listener

import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { useState, useEffect } from 'react';
import CustomerLogin from './Pages/CustomerLogin';
import CustomerRegister from './Pages/CustomerRegister';
import CustomerReauth from './Pages/CustomerReauth';
import CustomerHome from './Pages/CustomerHome';
import BuyVouchers from './Pages/BuyVouchers';
import OrderHistory from './Pages/OrderHistory';
import PlaceOrder from './Pages/PlaceOrder';
import MyAccount from './Pages/MyAccount';
import OrderDelivery from './Pages/OrderDelivery';
import MagicLinkHandler from './Components/MagicLinkHandler';
import MagicLinkDiagnostics from './Pages/MagicLinkDiagnostics';
import BottomNav from './Components/BottomNav';
import { theme } from './theme';

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
        setCustomer(null);
      }
    } else {
      // Explicitly clear customer when session is invalid or signed out
      setCustomer(null);
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
        background: theme.gradientPrimary
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

        {/* Magic Link diagnostics - no auth required */}
        <Route path="/diagnostics" element={<MagicLinkDiagnostics />} />

        {/* Login - Entry point: enter WhatsApp, old customer gets link, new goes to register */}
        <Route
          path="/"
          element={customer ? <Navigate to="/customer-home" replace /> : <CustomerLogin />}
        />
        <Route
          path="/login"
          element={customer ? <Navigate to="/customer-home" replace /> : <CustomerLogin />}
        />

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
              <Navigate to="/" replace />
            )
          }
        />
        <Route
          path="/buy-vouchers"
          element={
            customer ? (
              <BuyVouchers customer={customer} />
            ) : (
              <Navigate to="/" replace />
            )
          }
        />
        <Route
          path="/place-order"
          element={
            customer ? (
              <PlaceOrder customer={customer} />
            ) : (
              <Navigate to="/" replace />
            )
          }
        />
        <Route
          path="/orders"
          element={
            customer ? (
              <OrderHistory customer={customer} />
            ) : (
              <Navigate to="/" replace />
            )
          }
        />
        <Route
          path="/orders/:orderId/delivery"
          element={
            customer ? (
              <OrderDelivery />
            ) : (
              <Navigate to="/" replace />
            )
          }
        />
        <Route
          path="/account"
          element={
            customer ? (
              <MyAccount customer={customer} />
            ) : (
              <Navigate to="/" replace />
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
