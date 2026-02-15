// src/Components/MagicLinkHandler.tsx
// CORRECTED VERSION - Uses sessionStorage and proper navigation

import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../supabaseClient';

export default function MagicLinkHandler() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [status, setStatus] = useState<'validating' | 'success' | 'error'>('validating');
  const [message, setMessage] = useState('Memvalidasi link...');
  const [reauthPhone, setReauthPhone] = useState('');

  useEffect(() => {
    const token = searchParams.get('token');
    
    if (!token) {
      setStatus('error');
      setMessage('Token tidak ditemukan');
      setTimeout(() => navigate('/'), 3000);
      return;
    }

    validateToken(token);
  }, [searchParams, navigate]);

  const validateToken = async (token: string) => {
    try {
      console.log('🔐 Validating token...');

      const { data, error: functionError } = await supabase.functions.invoke('auth-validate-token', {
        body: { token }
      });

      if (functionError) throw functionError;
      if (data?.reauth_required) {
        setStatus('error');
        setMessage('Link kadaluarsa. Silakan verifikasi OTP untuk masuk.');
        setReauthPhone(data.whatsapp || '');
        setTimeout(() => {
          if (data.whatsapp) {
            navigate(`/reauth?whatsapp=${encodeURIComponent(data.whatsapp)}`);
          } else {
            navigate('/reauth');
          }
        }, 1500);
        return;
      }
      if (!data.success) throw new Error(data.error);

      console.log('✅ Token valid, customer:', data.customer);

      // Use sessionStorage instead of localStorage
      sessionStorage.setItem('customer', JSON.stringify(data.customer));
      sessionStorage.setItem('authenticated', 'true');
      
      // Store token for potential refresh
      if (data.new_token) {
        sessionStorage.setItem('auth_token', data.new_token);
        console.log('🔄 Token refreshed');
      } else {
        sessionStorage.setItem('auth_token', token);
      }

      setStatus('success');
      setMessage('✅ Login berhasil! Mengalihkan...');

      // Notify App.tsx and navigate to customer home
      setTimeout(() => {
        window.dispatchEvent(new Event('session-auth-updated'));
        navigate('/customer-home', { 
          replace: true
        });
      }, 1500);

    } catch (err: any) {
      console.error('❌ Token validation error:', err);
      setStatus('error');
      setMessage(err.message || 'Token tidak valid atau kadaluarsa');
      setTimeout(() => navigate('/'), 3000);
    }
  };

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
        boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
        padding: '60px 40px',
        textAlign: 'center',
        maxWidth: '400px',
        width: '100%'
      }}>
        {status === 'validating' && (
          <>
            <div style={{
              width: '80px',
              height: '80px',
              border: '6px solid #f3f3f3',
              borderTop: '6px solid #667eea',
              borderRadius: '50%',
              margin: '0 auto 30px',
              animation: 'spin 1s linear infinite'
            }} />
            <h2 style={{ fontSize: '24px', marginBottom: '15px', color: '#333' }}>
              🔐 Memvalidasi Link
            </h2>
            <p style={{ fontSize: '16px', color: '#666', margin: 0 }}>
              Tunggu sebentar...
            </p>
            <style>{`
              @keyframes spin {
                0% { transform: rotate(0deg); }
                100% { transform: rotate(360deg); }
              }
            `}</style>
          </>
        )}

        {status === 'success' && (
          <>
            <div style={{
              width: '80px',
              height: '80px',
              background: '#4caf50',
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 30px',
              fontSize: '50px'
            }}>
              ✅
            </div>
            <h2 style={{ fontSize: '24px', marginBottom: '15px', color: '#333' }}>
              Berhasil!
            </h2>
            <p style={{ fontSize: '16px', color: '#666', margin: 0 }}>
              {message}
            </p>
          </>
        )}

        {status === 'error' && (
          <>
            <div style={{
              width: '80px',
              height: '80px',
              background: '#f44336',
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 30px',
              fontSize: '50px'
            }}>
              ❌
            </div>
            <h2 style={{ fontSize: '24px', marginBottom: '15px', color: '#333' }}>
              Link Tidak Valid
            </h2>
            <p style={{ fontSize: '16px', color: '#666', marginBottom: '25px' }}>
              {message}
            </p>
            <button
              onClick={() => {
                if (reauthPhone) {
                  navigate(`/reauth?whatsapp=${encodeURIComponent(reauthPhone)}`);
                } else {
                  navigate('/');
                }
              }}
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
              {reauthPhone ? 'Verifikasi OTP' : 'Daftar Akun Baru'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
