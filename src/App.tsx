// src/App.tsx - CORRECTED VERSION
// Fixed: sessionStorage, storage event listener

import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { useState, useEffect } from 'react';
import CustomerLogin from './Pages/CustomerLogin';
import CustomerRegister from './Pages/CustomerRegister';
import CustomerReauth from './Pages/CustomerReauth';
import CustomerHome from './Pages/CustomerHome';
import BranchSelection from './Pages/BranchSelection';
import BuyVouchers from './Pages/BuyVouchers';
import OrderHistory from './Pages/OrderHistory';
import PlaceOrder from './Pages/PlaceOrder';
import MyAccount from './Pages/MyAccount';
import OrderDelivery from './Pages/OrderDelivery';
import MagicLinkHandler from './Components/MagicLinkHandler';
import MagicLinkDiagnostics from './Pages/MagicLinkDiagnostics';
import BottomNav from './Components/BottomNav';
import { LanguageProvider } from './contexts/LanguageContext';
import { theme } from './theme';
import { Toaster } from 'react-hot-toast';
import toast from 'react-hot-toast';

// Shown when customer tries to place order without a branch assigned
function NoBranchRedirect() {
  const navigate = useNavigate();
  useEffect(() => {
    toast.error('Please select your service branch first.');
    navigate('/customer-home', { replace: true });
  }, []);
  return null;
}

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
    <LanguageProvider>
      <Toaster
        position="top-center"
        toastOptions={{
          duration: 3000,
          style: { borderRadius: '10px', fontWeight: '600', fontSize: '14px' },
          success: { style: { background: '#e8f5e9', color: '#2e7d32' } },
          error: { style: { background: '#fdecea', color: '#c62828' } },
        }}
      />
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
              customer.branch === 'Pending' || !customer.branch ? (
                <BranchSelection customer={customer} />
              ) : (
                <CustomerHome customer={customer} />
              )
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
            !customer ? (
              <Navigate to="/" replace />
            ) : (!customer.branch || customer.branch === 'Pending') ? (
              <NoBranchRedirect />
            ) : (
              <PlaceOrder customer={customer} />
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
          path="/select-branch"
          element={
            customer ? (
              <BranchSelection customer={customer} mode="edit" />
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
    </LanguageProvider>
  );
}

export default App;
