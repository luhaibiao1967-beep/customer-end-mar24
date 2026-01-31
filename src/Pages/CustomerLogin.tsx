// src/Pages/CustomerLogin.tsx - Simple Mock Login (No Auth needed!)
import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../supabaseClient';

const DEV_MODE = true;
const FAKE_OTP = '123456';

export default function CustomerLogin() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [phoneNumber, setPhoneNumber] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [step, setStep] = useState<'phone' | 'otp'>('phone');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    const wa = searchParams.get('wa') || searchParams.get('whatsapp') || searchParams.get('phone');
    if (wa) {
      setPhoneNumber(wa);
      setMessage('WhatsApp number pre-filled from link');
    }
  }, [searchParams]);

  const formatPhoneNumber = (phone: string): string => {
    let cleaned = phone.replace(/\D/g, '');
    if (cleaned.startsWith('0')) {
      cleaned = '62' + cleaned.substring(1);
    }
    if (!cleaned.startsWith('62')) {
      cleaned = '62' + cleaned;
    }
    return '+' + cleaned;
  };

  const handleSendOTP = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setMessage('');

    try {
      const formattedPhone = formatPhoneNumber(phoneNumber);

      // Check if customer exists
      const { data: customer, error: customerError } = await supabase
        .from('customers')
        .select('*')
        .eq('whatsapp', formattedPhone)
        .single();

      if (customerError || !customer) {
        setError('Customer not found. Please register first.');
        setLoading(false);
        return;
      }

      console.log('✅ Customer found:', customer);

      if (DEV_MODE) {
        setMessage(`🔧 DEV MODE: Use OTP: ${FAKE_OTP}`);
        setStep('otp');
        setLoading(false);
      }
    } catch (err: any) {
      console.error('Login error:', err);
      setError(err.message || 'Failed to send OTP');
      setLoading(false);
    }
  };

  const handleVerifyOTP = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      // Check fake OTP
      if (otpCode !== FAKE_OTP) {
        throw new Error(`Invalid OTP. Use: ${FAKE_OTP}`);
      }

      const formattedPhone = formatPhoneNumber(phoneNumber);

      // Get customer
      const { data: customer, error: customerError } = await supabase
        .from('customers')
        .select('*')
        .eq('whatsapp', formattedPhone)
        .single();

      if (customerError || !customer) {
        throw new Error('Customer not found');
      }

      console.log('✅ Login successful:', customer);

      // Store customer data in localStorage (simple session)
      localStorage.setItem('customer', JSON.stringify(customer));
      localStorage.setItem('isLoggedIn', 'true');

      setMessage('✅ Login successful! Redirecting...');
      setTimeout(() => {
        navigate('/');
        window.location.reload(); // Force reload to update App.tsx
      }, 1000);

    } catch (err: any) {
      console.error('Verification error:', err);
      setError(err.message || 'Invalid OTP code');
      setLoading(false);
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
        width: '100%',
        maxWidth: '400px',
        overflow: 'hidden'
      }}>
        {/* Header */}
        <div style={{
          background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
          padding: '40px 20px',
          textAlign: 'center',
          color: 'white',
          position: 'relative'
        }}>
          {DEV_MODE && (
            <div style={{
              position: 'absolute',
              top: '10px',
              right: '10px',
              background: '#ffc107',
              color: '#000',
              padding: '5px 10px',
              borderRadius: '5px',
              fontSize: '12px',
              fontWeight: 'bold'
            }}>
              🔧 DEV
            </div>
          )}
          <div style={{
            width: '80px',
            height: '80px',
            background: 'white',
            borderRadius: '50%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 15px',
            fontSize: '40px'
          }}>
            💧
          </div>
          <h1 style={{ fontSize: '28px', fontWeight: 'bold', margin: '0 0 10px 0' }}>
            Water Delivery
          </h1>
          <p style={{ margin: 0, opacity: 0.9 }}>Customer Login</p>
        </div>

        {/* Content */}
        <div style={{ padding: '40px 30px' }}>
          {step === 'phone' ? (
            <form onSubmit={handleSendOTP}>
              <div style={{
                background: '#e3f2fd',
                border: '1px solid #90caf9',
                borderRadius: '8px',
                padding: '12px',
                marginBottom: '20px',
                fontSize: '13px',
                color: '#1976d2'
              }}>
                ℹ️ <strong>Dev Mode:</strong> No SMS costs. Use OTP: {FAKE_OTP}
              </div>

              <h2 style={{ fontSize: '20px', marginBottom: '10px', fontWeight: 'bold' }}>
                Enter Your Number
              </h2>
              <p style={{ fontSize: '14px', color: '#666', marginBottom: '25px' }}>
                For testing without SMS costs
              </p>

              {message && (
                <div style={{
                  background: '#e3f2fd',
                  border: '1px solid #90caf9',
                  borderRadius: '8px',
                  padding: '12px',
                  marginBottom: '20px',
                  color: '#1976d2',
                  fontSize: '14px'
                }}>
                  ℹ️ {message}
                </div>
              )}

              <div style={{ marginBottom: '20px' }}>
                <label style={{
                  display: 'block',
                  fontSize: '14px',
                  fontWeight: '500',
                  marginBottom: '8px',
                  color: '#333'
                }}>
                  WhatsApp Number
                </label>
                <div style={{ position: 'relative' }}>
                  <span style={{
                    position: 'absolute',
                    left: '15px',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    color: '#666',
                    fontSize: '16px'
                  }}>
                    +62
                  </span>
                  <input
                    type="tel"
                    value={phoneNumber}
                    onChange={(e) => setPhoneNumber(e.target.value)}
                    placeholder="812-3456-7890"
                    style={{
                      width: '100%',
                      padding: '12px 15px 12px 55px',
                      border: '2px solid #e0e0e0',
                      borderRadius: '8px',
                      fontSize: '16px',
                      boxSizing: 'border-box'
                    }}
                    required
                  />
                </div>
              </div>

              {error && (
                <div style={{
                  background: '#fee',
                  border: '1px solid #fcc',
                  borderRadius: '8px',
                  padding: '12px',
                  marginBottom: '20px',
                  color: '#c00',
                  fontSize: '14px'
                }}>
                  ⚠️ {error}
                </div>
              )}

              <button
                type="submit"
                disabled={loading || !phoneNumber}
                style={{
                  width: '100%',
                  padding: '14px',
                  background: (loading || !phoneNumber) ? '#ccc' : 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                  color: 'white',
                  border: 'none',
                  borderRadius: '8px',
                  fontSize: '16px',
                  fontWeight: 'bold',
                  cursor: (loading || !phoneNumber) ? 'not-allowed' : 'pointer',
                  marginBottom: '15px'
                }}
              >
                {loading ? '⏳ Checking...' : '📱 Send OTP Code'}
              </button>

              <div style={{ textAlign: 'center' }}>
                <p style={{ fontSize: '14px', color: '#666', margin: 0 }}>
                  New customer?{' '}
                  <button
                    type="button"
                    onClick={() => navigate(`/register${phoneNumber ? `?whatsapp=${phoneNumber}` : ''}`)}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: '#667eea',
                      fontWeight: 'bold',
                      cursor: 'pointer',
                      textDecoration: 'underline',
                      fontSize: '14px'
                    }}
                  >
                    Register here
                  </button>
                </p>
              </div>
            </form>
          ) : (
            <form onSubmit={handleVerifyOTP}>
              <h2 style={{ fontSize: '20px', marginBottom: '10px', fontWeight: 'bold' }}>
                🔧 Enter Fake OTP
              </h2>
              <p style={{ fontSize: '14px', color: '#666', marginBottom: '25px' }}>
                Use: <strong style={{ color: '#667eea', fontSize: '20px' }}>{FAKE_OTP}</strong>
              </p>

              {message && (
                <div style={{
                  background: '#e8f5e9',
                  border: '1px solid #81c784',
                  borderRadius: '8px',
                  padding: '12px',
                  marginBottom: '20px',
                  color: '#2e7d32',
                  fontSize: '14px'
                }}>
                  {message}
                </div>
              )}

              <div style={{ marginBottom: '20px' }}>
                <input
                  type="text"
                  value={otpCode}
                  onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="123456"
                  style={{
                    width: '100%',
                    padding: '12px',
                    border: '2px solid #e0e0e0',
                    borderRadius: '8px',
                    fontSize: '32px',
                    textAlign: 'center',
                    letterSpacing: '12px',
                    fontFamily: 'monospace',
                    boxSizing: 'border-box'
                  }}
                  maxLength={6}
                  required
                  autoFocus
                />
              </div>

              {error && (
                <div style={{
                  background: '#fee',
                  border: '1px solid #fcc',
                  borderRadius: '8px',
                  padding: '12px',
                  marginBottom: '20px',
                  color: '#c00',
                  fontSize: '14px'
                }}>
                  ⚠️ {error}
                </div>
              )}

              <button
                type="submit"
                disabled={loading || otpCode.length !== 6}
                style={{
                  width: '100%',
                  padding: '14px',
                  background: (loading || otpCode.length !== 6) ? '#ccc' : 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                  color: 'white',
                  border: 'none',
                  borderRadius: '8px',
                  fontSize: '16px',
                  fontWeight: 'bold',
                  cursor: (loading || otpCode.length !== 6) ? 'not-allowed' : 'pointer',
                  marginBottom: '15px'
                }}
              >
                {loading ? '🔄 Verifying...' : '✅ Verify & Login'}
              </button>

              <div style={{ textAlign: 'center' }}>
                <button
                  type="button"
                  onClick={() => {
                    setStep('phone');
                    setOtpCode('');
                    setError('');
                    setMessage('');
                  }}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: '#667eea',
                    fontSize: '14px',
                    cursor: 'pointer',
                    textDecoration: 'underline'
                  }}
                >
                  ← Change Number
                </button>
              </div>
            </form>
          )}
        </div>

        {/* Footer */}
        <div style={{
          background: '#f5f5f5',
          padding: '20px',
          textAlign: 'center',
          borderTop: '1px solid #e0e0e0'
        }}>
          <p style={{ margin: 0, fontSize: '12px', color: '#999' }}>
            🔧 Dev Mode - Uses localStorage (no auth)
          </p>
        </div>
      </div>
    </div>
  );
}
