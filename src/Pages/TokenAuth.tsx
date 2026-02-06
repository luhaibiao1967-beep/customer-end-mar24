// src/Pages/TokenAuth.tsx - Works with existing auth-validate-token function
import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../supabaseClient';

interface Customer {
  id: string;
  name: string;
  address: string;
  whatsapp: string;
  customer_type: 'pre_paid' | 'later_paid';
  voucher_balance: number;
  discount: number;
  branch: string;
}

export default function TokenAuth() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [customer, setCustomer] = useState<Customer | null>(null);

  useEffect(() => {
    const token = searchParams.get('token');
    
    if (!token) {
      setError('Invalid authentication link');
      setLoading(false);
      return;
    }

    validateToken(token);
  }, [searchParams]);

  const validateToken = async (token: string) => {
    try {
      console.log('🔐 Validating token...');

      // Call your existing auth-validate-token function
      const { data, error: functionError } = await supabase.functions.invoke('auth-validate-token', {
        body: { token }
      });

      console.log('Response:', data);

      if (functionError) throw functionError;
      if (!data.success) throw new Error(data.error);

      const customerData: Customer = {
        id: data.customer.id,
        name: data.customer.name,
        address: data.customer.address,
        whatsapp: data.customer.whatsapp,
        customer_type: data.customer.customer_type,
        voucher_balance: data.customer.voucher_balance,
        discount: data.customer.discount,
        branch: data.customer.branch,
      };

      setCustomer(customerData);

      // Store customer in sessionStorage for this session
      sessionStorage.setItem('customer', JSON.stringify(customerData));
      sessionStorage.setItem('authenticated', 'true');
      sessionStorage.setItem('auth_token', token);

      // If token was refreshed, update the URL
      if (data.new_token) {
        sessionStorage.setItem('auth_token', data.new_token);
        console.log('🔄 Token refreshed');
      }

      console.log('✅ Authentication successful');

      // Redirect to customer home
      setTimeout(() => {
        navigate('/home', { 
          replace: true,
          state: { customer: customerData }
        });
      }, 1500);

    } catch (err: any) {
      console.error('❌ Authentication failed:', err);
      setError(err.message || 'Authentication failed. Please request a new link.');
      setLoading(false);
    }
  };

  if (loading && !error) {
    return (
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
          textAlign: 'center',
          maxWidth: '400px',
          width: '100%',
          boxShadow: '0 10px 40px rgba(0,0,0,0.2)'
        }}>
          <div style={{
            width: '80px',
            height: '80px',
            margin: '0 auto 20px',
            borderRadius: '50%',
            border: '4px solid #667eea',
            borderTopColor: 'transparent',
            animation: 'spin 1s linear infinite'
          }} />
          <h2 style={{ marginBottom: '10px', fontSize: '24px' }}>
            🔐 Verifying Access...
          </h2>
          <p style={{ color: '#666', fontSize: '14px' }}>
            Please wait while we verify your link
          </p>
        </div>

        <style>{`
          @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
        `}</style>
      </div>
    );
  }

  if (customer) {
    return (
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
          textAlign: 'center',
          maxWidth: '400px',
          width: '100%',
          boxShadow: '0 10px 40px rgba(0,0,0,0.2)'
        }}>
          <div style={{
            width: '80px',
            height: '80px',
            margin: '0 auto 20px',
            background: '#4caf50',
            borderRadius: '50%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '40px'
          }}>
            ✓
          </div>
          <h2 style={{ marginBottom: '10px', fontSize: '24px', color: '#4caf50' }}>
            Selamat Datang!
          </h2>
          <p style={{ color: '#666', fontSize: '16px', marginBottom: '20px' }}>
            Hai <strong>{customer.name || 'Customer'}</strong>
          </p>
          <p style={{ color: '#999', fontSize: '14px' }}>
            Mengarahkan ke halaman Anda...
          </p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
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
          textAlign: 'center',
          maxWidth: '400px',
          width: '100%',
          boxShadow: '0 10px 40px rgba(0,0,0,0.2)'
        }}>
          <div style={{
            width: '80px',
            height: '80px',
            margin: '0 auto 20px',
            background: '#f44336',
            borderRadius: '50%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '40px',
            color: 'white'
          }}>
            ✕
          </div>
          <h2 style={{ marginBottom: '10px', fontSize: '24px', color: '#f44336' }}>
            Link Tidak Valid
          </h2>
          <p style={{ color: '#666', fontSize: '14px', marginBottom: '30px' }}>
            {error}
          </p>
          <button
            onClick={() => navigate('/register')}
            style={{
              width: '100%',
              padding: '14px',
              background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
              color: 'white',
              border: 'none',
              borderRadius: '8px',
              fontSize: '16px',
              fontWeight: 'bold',
              cursor: 'pointer'
            }}
          >
            Kembali ke Pendaftaran
          </button>
        </div>
      </div>
    );
  }

  return null;
}
