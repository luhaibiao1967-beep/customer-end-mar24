// src/Pages/CustomerRegister.tsx - Fixed: correct column name + RLS bypass
import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../supabaseClient';

// 🔧 DEVELOPMENT MODE - Fake OTP
const DEV_MODE = true;
const FAKE_OTP = '123456';

export default function CustomerRegister() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [step, setStep] = useState<'form' | 'otp'>('form');
  const [formData, setFormData] = useState({
    name: '',
    address: '',
    whatsapp: '',
  });
  const [otpCode, setOtpCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    const wa = searchParams.get('whatsapp') || searchParams.get('wa') || searchParams.get('phone');
    if (wa) {
      setFormData(prev => ({ ...prev, whatsapp: wa }));
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

  const handleSubmitForm = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setMessage('');

    try {
      if (!formData.name || !formData.address || !formData.whatsapp) {
        throw new Error('Please fill all required fields');
      }

      const formattedWhatsApp = formatPhoneNumber(formData.whatsapp);

      // Check if WhatsApp already registered
      const { data: existingCustomer } = await supabase
        .from('customers')
        .select('id')
        .eq('whatsapp', formattedWhatsApp)
        .single();

      if (existingCustomer) {
        throw new Error('WhatsApp number already registered. Please login instead.');
      }

      setMessage(`🔧 DEV MODE: Use OTP code: ${FAKE_OTP}`);
      setStep('otp');
      setLoading(false);
    } catch (err: any) {
      console.error('Registration error:', err);
      setError(err.message || 'Failed to process registration');
      setLoading(false);
    }
  };

  const handleVerifyOTP = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setMessage('Creating your account...');

    try {
      // Check fake OTP
      if (otpCode !== FAKE_OTP) {
        throw new Error(`Invalid OTP. Use: ${FAKE_OTP}`);
      }

      const formattedWhatsApp = formatPhoneNumber(formData.whatsapp);
      console.log('✅ OTP Verified');
      console.log('🔧 Creating customer record...');

      // ✅ FIXED: Use 'address' not 'addr'
      const customerData = {
        name: formData.name,
        address: formData.address,  // ← FIXED: 'address' not 'addr'
        whatsapp: formattedWhatsApp,
        phone: formattedWhatsApp,
        customer_type: 'pre_pay',
        voucher_balance: 5,
        discount: 0,
        branch: 'Jakarta',
        auth_user_id: null,
        created_by: null,
      };

      console.log('Customer data:', customerData);

      const { data: customer, error: customerError } = await supabase
        .from('customers')
        .insert([customerData])
        .select()
        .single();

      if (customerError) {
        console.error('❌ Customer creation error:', customerError);
        console.error('Error details:', {
          code: customerError.code,
          message: customerError.message,
          details: customerError.details,
          hint: customerError.hint
        });
        throw new Error(`Failed to create customer: ${customerError.message}`);
      }

      console.log('✅ Customer created successfully!', customer);

      setMessage('✅ Registration successful! Redirecting to login...');
      
      setTimeout(() => {
        navigate(`/login?wa=${formData.whatsapp}`);
      }, 2000);

    } catch (err: any) {
      console.error('❌ Registration error:', err);
      setError(err.message || 'Registration failed');
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
        maxWidth: '450px',
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
            🔧 DEV MODE
          </div>
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
            👤
          </div>
          <h1 style={{ fontSize: '28px', fontWeight: 'bold', margin: '0 0 10px 0' }}>
            Welcome!
          </h1>
          <p style={{ margin: 0, opacity: 0.9 }}>Create account (Fake OTP: {FAKE_OTP})</p>
        </div>

        {/* Content */}
        <div style={{ padding: '40px 30px' }}>
          {step === 'form' ? (
            <form onSubmit={handleSubmitForm}>
              <div style={{
                background: '#e3f2fd',
                border: '1px solid #90caf9',
                borderRadius: '8px',
                padding: '12px',
                marginBottom: '20px',
                fontSize: '13px',
                color: '#1976d2'
              }}>
                ℹ️ <strong>Step 1:</strong> Fill form → <strong>Step 2:</strong> Enter {FAKE_OTP}
              </div>

              <h2 style={{ fontSize: '20px', marginBottom: '25px', fontWeight: 'bold' }}>
                Registration Form
              </h2>

              {/* Name */}
              <div style={{ marginBottom: '20px' }}>
                <label style={{
                  display: 'block',
                  fontSize: '14px',
                  fontWeight: '500',
                  marginBottom: '8px',
                  color: '#333'
                }}>
                  Full Name *
                </label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="Mike Lu"
                  style={{
                    width: '100%',
                    padding: '12px 15px',
                    border: '2px solid #e0e0e0',
                    borderRadius: '8px',
                    fontSize: '16px',
                    boxSizing: 'border-box'
                  }}
                  required
                />
              </div>

              {/* Address */}
              <div style={{ marginBottom: '20px' }}>
                <label style={{
                  display: 'block',
                  fontSize: '14px',
                  fontWeight: '500',
                  marginBottom: '8px',
                  color: '#333'
                }}>
                  📍 Delivery Address *
                </label>
                <textarea
                  value={formData.address}
                  onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                  placeholder="Edogawa 30/17, Tokyo Riverside Apartment"
                  style={{
                    width: '100%',
                    padding: '12px 15px',
                    border: '2px solid #e0e0e0',
                    borderRadius: '8px',
                    fontSize: '16px',
                    boxSizing: 'border-box',
                    resize: 'vertical',
                    minHeight: '80px',
                    fontFamily: 'inherit'
                  }}
                  rows={3}
                  required
                />
              </div>

              {/* WhatsApp */}
              <div style={{ marginBottom: '20px' }}>
                <label style={{
                  display: 'block',
                  fontSize: '14px',
                  fontWeight: '500',
                  marginBottom: '8px',
                  color: '#333'
                }}>
                  💬 WhatsApp Number *
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
                    value={formData.whatsapp}
                    onChange={(e) => setFormData({ ...formData, whatsapp: e.target.value })}
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
                disabled={loading}
                style={{
                  width: '100%',
                  padding: '14px',
                  background: loading ? '#ccc' : 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                  color: 'white',
                  border: 'none',
                  borderRadius: '8px',
                  fontSize: '16px',
                  fontWeight: 'bold',
                  cursor: loading ? 'not-allowed' : 'pointer',
                  marginBottom: '15px'
                }}
              >
                {loading ? '⏳ Checking...' : 'Next →'}
              </button>

              <div style={{ textAlign: 'center' }}>
                <p style={{ fontSize: '14px', color: '#666', margin: 0 }}>
                  Already have an account?{' '}
                  <button
                    type="button"
                    onClick={() => navigate('/login')}
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
                    Login here
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
                Use the code: <strong style={{ color: '#667eea', fontSize: '20px' }}>{FAKE_OTP}</strong>
              </p>

              {message && (
                <div style={{
                  background: message.includes('✅') ? '#e8f5e9' : '#e3f2fd',
                  border: `1px solid ${message.includes('✅') ? '#81c784' : '#90caf9'}`,
                  borderRadius: '8px',
                  padding: '12px',
                  marginBottom: '20px',
                  color: message.includes('✅') ? '#2e7d32' : '#1976d2',
                  fontSize: '14px',
                  textAlign: 'center'
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
                {loading ? '⏳ Creating Account...' : '✅ Complete Registration'}
              </button>

              <div style={{ textAlign: 'center' }}>
                <button
                  type="button"
                  onClick={() => {
                    setStep('form');
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
                  ← Back
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
            🔧 Dev Mode - Customer created with 5 free vouchers
          </p>
        </div>
      </div>
    </div>
  );
}
