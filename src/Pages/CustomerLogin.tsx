// src/Pages/CustomerLogin.tsx - Mock Development Login (No SMS needed)
import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../supabaseClient';

export default function CustomerLogin() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [phoneNumber, setPhoneNumber] = useState('');
  const [magicLink, setMagicLink] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [showMagicLink, setShowMagicLink] = useState(false);

  useEffect(() => {
    // Pre-fill WhatsApp if provided in URL
    const wa = searchParams.get('wa') || searchParams.get('whatsapp') || searchParams.get('phone');
    if (wa) {
      setPhoneNumber(wa);
      setMessage('WhatsApp number detected from link');
    }

    // Check for magic link token in URL (when user clicks the link)
    const token = searchParams.get('token');
    const type = searchParams.get('type');
    if (token && type === 'magiclink') {
      handleMagicLinkVerification(token);
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

  const handleGenerateMagicLink = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setMessage('');
    setShowMagicLink(false);

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

      // Generate magic link (email-based to avoid SMS costs)
      // We use email as a workaround - use phone number as email format
      const mockEmail = `${formattedPhone.replace('+', '')}@mock.customer.local`;
      
      const { data, error: linkError } = await supabase.auth.signInWithOtp({
        email: mockEmail,
        options: {
          emailRedirectTo: `${window.location.origin}/login`,
        },
      });

      if (linkError) throw linkError;

      setMessage('✅ Magic link generated! Copy the link below:');
      setShowMagicLink(true);
      
      // For development: Show instructions
      setMagicLink(`
📋 DEVELOPMENT MODE - Magic Link Instructions:

1. Go to Supabase Dashboard → Authentication → Users
2. Find user: ${mockEmail}
3. Click on the user
4. Look for "Email Confirmation Token" or check your Supabase logs
5. Or use this direct login method below ⬇️

🔧 QUICK DEV LOGIN (No link needed):
Just click the "Quick Dev Login" button below to simulate clicking the magic link!
      `);

    } catch (err: any) {
      console.error('Login error:', err);
      setError(err.message || 'Failed to generate magic link');
    } finally {
      setLoading(false);
    }
  };

  const handleQuickDevLogin = async () => {
    setLoading(true);
    setError('');
    setMessage('');

    try {
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

      // Create or get auth user
      const mockEmail = `${formattedPhone.replace('+', '')}@mock.customer.local`;
      
      // Sign up if doesn't exist (this creates the auth user)
      const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
        email: mockEmail,
        password: `dev_password_${formattedPhone}`, // Mock password for dev
        options: {
          data: {
            phone: formattedPhone,
          },
        },
      });

      // If already exists, sign in instead
      if (signUpError?.message?.includes('already registered')) {
        const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
          email: mockEmail,
          password: `dev_password_${formattedPhone}`,
        });

        if (signInError) throw signInError;

        // Link customer to auth user if not linked
        if (!customer.auth_user_id && signInData.user) {
          await supabase
            .from('customers')
            .update({ auth_user_id: signInData.user.id })
            .eq('id', customer.id);
        }
      } else if (signUpData.user) {
        // Link customer to newly created auth user
        await supabase
          .from('customers')
          .update({ auth_user_id: signUpData.user.id })
          .eq('id', customer.id);
      }

      setMessage('✅ Development login successful! Redirecting...');
      setTimeout(() => {
        navigate('/');
      }, 1000);

    } catch (err: any) {
      console.error('Quick dev login error:', err);
      setError(err.message || 'Quick dev login failed');
    } finally {
      setLoading(false);
    }
  };

  const handleMagicLinkVerification = async (token: string) => {
    setLoading(true);
    try {
      const { error: verifyError } = await supabase.auth.verifyOtp({
        token_hash: token,
        type: 'magiclink',
      });

      if (verifyError) throw verifyError;

      setMessage('✅ Login successful! Redirecting...');
      setTimeout(() => {
        navigate('/');
      }, 1000);
    } catch (err: any) {
      console.error('Magic link verification error:', err);
      setError(err.message || 'Invalid magic link');
    } finally {
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
        maxWidth: showMagicLink ? '600px' : '400px',
        overflow: 'hidden',
        transition: 'max-width 0.3s'
      }}>
        {/* Header */}
        <div style={{
          background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
          padding: '40px 20px',
          textAlign: 'center',
          color: 'white'
        }}>
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
          <p style={{ margin: 0, opacity: 0.9 }}>Development Mode - No SMS Cost</p>
        </div>

        {/* Content */}
        <div style={{ padding: '40px 30px' }}>
          <form onSubmit={handleGenerateMagicLink}>
            <div style={{
              background: '#fff3cd',
              border: '1px solid #ffc107',
              borderRadius: '8px',
              padding: '12px',
              marginBottom: '20px',
              fontSize: '13px',
              color: '#856404'
            }}>
              🔧 <strong>Development Mode:</strong> No SMS/WhatsApp costs. Uses mock authentication.
            </div>

            <h2 style={{ fontSize: '20px', marginBottom: '10px', fontWeight: 'bold' }}>
              Enter Your Number
            </h2>
            <p style={{ fontSize: '14px', color: '#666', marginBottom: '25px' }}>
              For testing without SMS costs
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
                  disabled={showMagicLink}
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

            {!showMagicLink ? (
              <>
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
                  {loading ? '⏳ Generating...' : '🔗 Generate Magic Link'}
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
              </>
            ) : (
              <>
                <div style={{
                  background: '#f5f5f5',
                  border: '1px solid #ddd',
                  borderRadius: '8px',
                  padding: '20px',
                  marginBottom: '20px',
                  fontFamily: 'monospace',
                  fontSize: '13px',
                  whiteSpace: 'pre-wrap',
                  maxHeight: '200px',
                  overflowY: 'auto'
                }}>
                  {magicLink}
                </div>

                <button
                  type="button"
                  onClick={handleQuickDevLogin}
                  disabled={loading}
                  style={{
                    width: '100%',
                    padding: '14px',
                    background: loading ? '#ccc' : '#28a745',
                    color: 'white',
                    border: 'none',
                    borderRadius: '8px',
                    fontSize: '16px',
                    fontWeight: 'bold',
                    cursor: loading ? 'not-allowed' : 'pointer',
                    marginBottom: '10px'
                  }}
                >
                  {loading ? '⏳ Logging in...' : '⚡ Quick Dev Login (Skip Link)'}
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setShowMagicLink(false);
                    setMagicLink('');
                    setMessage('');
                    setError('');
                  }}
                  style={{
                    width: '100%',
                    padding: '12px',
                    background: 'none',
                    color: '#667eea',
                    border: '2px solid #667eea',
                    borderRadius: '8px',
                    fontSize: '14px',
                    fontWeight: 'bold',
                    cursor: 'pointer'
                  }}
                >
                  ← Try Different Number
                </button>
              </>
            )}
          </form>
        </div>

        {/* Footer */}
        <div style={{
          background: '#f5f5f5',
          padding: '20px',
          textAlign: 'center',
          borderTop: '1px solid #e0e0e0'
        }}>
          <p style={{ margin: 0, fontSize: '12px', color: '#999' }}>
            🔧 Development Mode - No SMS costs
          </p>
        </div>
      </div>
    </div>
  );
}
