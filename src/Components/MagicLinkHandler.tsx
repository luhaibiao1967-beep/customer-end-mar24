// src/components/MagicLinkHandler.tsx
// Place this file in: src/components/MagicLinkHandler.tsx

import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../supabaseClient';

export default function MagicLinkHandler() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [status, setStatus] = useState<'validating' | 'success' | 'error'>('validating');
  const [message, setMessage] = useState('Memvalidasi link...');

  useEffect(() => {
    const token = searchParams.get('token');
    
    if (!token) {
      setStatus('error');
      setMessage('Token tidak ditemukan');
      setTimeout(() => navigate('/register'), 3000);
      return;
    }

    validateToken(token);
  }, [searchParams, navigate]);

  const validateToken = async (token: string) => {
    try {
      const { data, error: functionError } = await supabase.functions.invoke('auth-validate-token', {
        body: { token }
      });

      if (functionError) throw functionError;
      if (!data.success) throw new Error(data.error);

      localStorage.setItem('customer', JSON.stringify(data.customer));
      localStorage.setItem('isLoggedIn', 'true');
      
      if (data.new_token) {
        localStorage.setItem('authToken', data.new_token);
      } else {
        localStorage.setItem('authToken', token);
      }

      setStatus('success');
      setMessage('✅ Login berhasil! Mengalihkan...');

      setTimeout(() => {
        navigate('/');
        window.location.reload();
      }, 1500);

    } catch (err: any) {
      console.error('Token validation error:', err);
      setStatus('error');
      setMessage(err.message || 'Token tidak valid atau kadaluarsa');
      setTimeout(() => navigate('/register'), 3000);
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
              onClick={() => navigate('/register')}
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
              Daftar Akun Baru
            </button>
          </>
        )}
      </div>
    </div>
  );
}
