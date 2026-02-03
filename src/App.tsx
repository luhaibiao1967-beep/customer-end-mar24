// src/App.tsx - Magic Link Only Authentication (No Login Page!)
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { useState, useEffect } from 'react';
import CustomerRegister from './Pages/CustomerRegister';
import CustomerHome from './Pages/CustomerHome';
import BuyVouchers from './Pages/BuyVouchers';
import OrderHistory from './Pages/OrderHistory';
import PlaceOrder from './Pages/PlaceOrder';
import MagicLinkHandler from './Components/MagicLinkHandler';

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
        localStorage.removeItem('authToken');
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
        {/* Magic Link Route - Primary authentication method */}
        <Route 
          path="/home" 
          element={<MagicLinkHandler />} 
        />

        {/* Public registration - only page that doesn't require authentication */}
        <Route 
          path="/register" 
          element={customer ? <Navigate to="/" replace /> : <CustomerRegister />} 
        />

        {/* Protected routes - require magic link authentication */}
        <Route
          path="/"
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

        {/* Catch all - redirect to registration */}
        <Route path="*" element={<Navigate to="/register" replace />} />
      </Routes>
    </Router>
  );
}

export default App;
