// src/Pages/CustomerRegister.tsx - Bilingual with button disable after success
import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import { FunctionsHttpError } from '@supabase/supabase-js';

type Language = 'id' | 'en';

const translations = {
  id: {
    title: 'Selamat Datang!',
    subtitle: 'Daftar akun baru',
    step1: 'Langkah 1: Isi formulir',
    step2: 'Langkah 2: Verifikasi WhatsApp OTP',
    formTitle: 'Formulir Pendaftaran',
    otpTitle: 'Verifikasi WhatsApp',
    otpSubtitle: 'Masukkan kode OTP yang dikirim ke WhatsApp Anda',
    nameLabel: 'Nama Lengkap',
    namePlaceholder: 'Budi Santoso',
    addressLabel: 'Alamat Pengiriman',
    addressPlaceholder: 'Jl. Sudirman No. 123, Jakarta Selatan',
    whatsappLabel: 'Nomor WhatsApp',
    whatsappPlaceholder: '812-3456-7890',
    buttonNext: 'Lanjut',
    buttonSending: 'Mengirim OTP...',
    buttonVerify: 'Selesaikan Pendaftaran',
    buttonVerifying: 'Membuat Akun...',
    otpExpires: 'Kode berlaku',
    resendOtp: 'Kirim ulang kode OTP',
    resendIn: 'Kirim ulang dalam',
    changeNumber: 'Ubah Nomor',
    haveAccount: 'Sudah punya akun?',
    checkWhatsapp: 'Cek WhatsApp Anda untuk link pesanan',
    nextStep: 'Langkah selanjutnya:',
    openWhatsapp: 'Buka WhatsApp Anda dan klik link yang dikirim untuk mulai memesan!',
    footerBonus: 'Dapat 5 voucher gratis saat pendaftaran',
    errorRequired: 'Mohon isi semua field yang diperlukan',
    successTitle: 'Pendaftaran berhasil!',
    successMessage: 'Link pesanan telah dikirim ke WhatsApp Anda. Silakan cek WhatsApp untuk melanjutkan.',
    registrationComplete: 'Pendaftaran Selesai',
  },
  en: {
    title: 'Welcome!',
    subtitle: 'Create new account',
    step1: 'Step 1: Fill the form',
    step2: 'Step 2: Verify WhatsApp OTP',
    formTitle: 'Registration Form',
    otpTitle: 'WhatsApp Verification',
    otpSubtitle: 'Enter the OTP code sent to your WhatsApp',
    nameLabel: 'Full Name',
    namePlaceholder: 'John Doe',
    addressLabel: 'Delivery Address',
    addressPlaceholder: 'Jl. Sudirman No. 123, South Jakarta',
    whatsappLabel: 'WhatsApp Number',
    whatsappPlaceholder: '812-3456-7890',
    buttonNext: 'Next',
    buttonSending: 'Sending OTP...',
    buttonVerify: 'Complete Registration',
    buttonVerifying: 'Creating Account...',
    otpExpires: 'Code expires in',
    resendOtp: 'Resend OTP code',
    resendIn: 'Resend in',
    changeNumber: 'Change Number',
    haveAccount: 'Already have an account?',
    checkWhatsapp: 'Check your WhatsApp for order link',
    nextStep: 'Next step:',
    openWhatsapp: 'Open your WhatsApp and click the link sent to start ordering!',
    footerBonus: 'Get 5 free vouchers upon registration',
    errorRequired: 'Please fill all required fields',
    successTitle: 'Registration successful!',
    successMessage: 'Order link has been sent to your WhatsApp. Please check WhatsApp to continue.',
    registrationComplete: 'Registration Complete',
  }
};

export default function CustomerRegister() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [language, setLanguage] = useState<Language>('id');
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
  const [countdown, setCountdown] = useState(0);
  const [registrationSuccess, setRegistrationSuccess] = useState(false);
  const [devMagicLink, setDevMagicLink] = useState('');

  const t = translations[language];

  useEffect(() => {
    const wa = searchParams.get('whatsapp') || searchParams.get('wa') || searchParams.get('phone');
    if (wa) {
      setFormData(prev => ({ ...prev, whatsapp: wa }));
    }
  }, [searchParams]);

  useEffect(() => {
    if (countdown > 0) {
      const timer = setTimeout(() => setCountdown(countdown - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [countdown]);

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
        throw new Error(t.errorRequired);
      }

      const formattedWhatsApp = formatPhoneNumber(formData.whatsapp);

      const supabaseUrl = import.meta.env.VITE_SUPABASE_MODE === 'cloud'
        ? (import.meta.env.VITE_SUPABASE_URL_CLOUD || 'https://zpxdxyjzseuvdhxbuqpc.supabase.co')
        : `${window.location.origin}/supabase`;
      console.log('Calling Edge Function:', {
        url: `${supabaseUrl}/functions/v1/auth-send-otp`,
        phone: formattedWhatsApp
      });

      const { data, error: functionError } = await supabase.functions.invoke('auth-send-otp', {
        body: { phone: formattedWhatsApp }
      });

      console.log('Edge Function response:', { data, functionError });

      if (functionError) {
        let errMsg = data?.error || functionError.message;
        if (functionError instanceof FunctionsHttpError && functionError.context) {
          try {
            const body = await functionError.context.json();
            errMsg = body?.error || errMsg;
          } catch (_) {}
        }
        throw new Error(errMsg);
      }
      if (!data?.success) throw new Error(data?.error || 'OTP send failed');

      setMessage(`📱 ${language === 'id' ? 'Kode OTP telah dikirim ke WhatsApp' : 'OTP code has been sent to WhatsApp'} ${formattedWhatsApp}`);
      setStep('otp');
      setCountdown(300);
      setLoading(false);
    } catch (err: any) {
      console.error('Registration error:', err);
      setError(err.message || 'Failed to process registration');
      setLoading(false);
    }
  };

  const handleVerifyOTP = async (e: React.FormEvent) => {
    e.preventDefault();
    if (registrationSuccess) return; // Prevent double submission
    
    setLoading(true);
    setError('');
    setMessage(language === 'id' ? 'Membuat akun Anda...' : 'Creating your account...');

    try {
      const formattedWhatsApp = formatPhoneNumber(formData.whatsapp);

      const { data, error: functionError } = await supabase.functions.invoke('auth-verify-otp', {
        body: {
          phone: formattedWhatsApp,
          otp: otpCode,
          name: formData.name,
          address: formData.address,
          isRegistration: true,
        }
      });

      console.log('Registration response:', { data, functionError });

      if (functionError) {
        let errMsg = data?.error || functionError.message;
        if (functionError instanceof FunctionsHttpError && functionError.context) {
          try {
            const body = await functionError.context.json();
            errMsg = body?.error || errMsg;
          } catch (_) {}
        }
        throw new Error(errMsg);
      }
      if (!data?.success) throw new Error(data?.error || 'Verification failed');

      setRegistrationSuccess(true);
      setMessage(t.successMessage);
      if (data.dev_mode && data.magic_link) {
        setDevMagicLink(data.magic_link);
      }
      setLoading(false);

    } catch (err: any) {
      console.error('❌ Registration error:', err);
      setError(err.message || 'Registration failed');
      setLoading(false);
    }
  };

  const handleResendOTP = async () => {
    if (countdown > 0 || registrationSuccess) return;
    
    setLoading(true);
    setError('');
    setMessage(language === 'id' ? 'Mengirim ulang OTP...' : 'Resending OTP...');

    try {
      const formattedWhatsApp = formatPhoneNumber(formData.whatsapp);

      const { data, error: functionError } = await supabase.functions.invoke('auth-send-otp', {
        body: { phone: formattedWhatsApp }
      });

      if (functionError) {
        let errMsg = data?.error || functionError.message;
        if (functionError instanceof FunctionsHttpError && functionError.context) {
          try {
            const body = await functionError.context.json();
            errMsg = body?.error || errMsg;
          } catch (_) {}
        }
        throw new Error(errMsg);
      }
      if (!data?.success) throw new Error(data?.error || 'Resend failed');

      setMessage(language === 'id' ? '📱 Kode OTP baru telah dikirim!' : '📱 New OTP code has been sent!');
      setCountdown(300);
      setOtpCode('');
      setLoading(false);
    } catch (err: any) {
      setError(err.message || 'Failed to resend OTP');
      setLoading(false);
    }
  };

  const formatCountdown = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
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
        overflow: 'hidden',
        position: 'relative'
      }}>
        {/* Language Toggle */}
        <div style={{
          position: 'absolute',
          top: '20px',
          right: '20px',
          zIndex: 10,
          display: 'flex',
          gap: '8px',
          background: 'white',
          borderRadius: '20px',
          padding: '4px',
          boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
        }}>
          <button
            onClick={() => setLanguage('id')}
            disabled={registrationSuccess}
            style={{
              padding: '6px 14px',
              background: language === 'id' ? 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' : 'transparent',
              border: 'none',
              borderRadius: '16px',
              color: language === 'id' ? 'white' : '#667eea',
              fontWeight: 'bold',
              cursor: registrationSuccess ? 'not-allowed' : 'pointer',
              fontSize: '13px',
              opacity: registrationSuccess ? 0.5 : 1,
              transition: 'all 0.3s ease'
            }}
          >
            ID
          </button>
          <button
            onClick={() => setLanguage('en')}
            disabled={registrationSuccess}
            style={{
              padding: '6px 14px',
              background: language === 'en' ? 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' : 'transparent',
              border: 'none',
              borderRadius: '16px',
              color: language === 'en' ? 'white' : '#667eea',
              fontWeight: 'bold',
              cursor: registrationSuccess ? 'not-allowed' : 'pointer',
              fontSize: '13px',
              opacity: registrationSuccess ? 0.5 : 1,
              transition: 'all 0.3s ease'
            }}
          >
            EN
          </button>
        </div>

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
            {registrationSuccess ? '✅' : '👤'}
          </div>
          <h1 style={{ fontSize: '28px', fontWeight: 'bold', margin: '0 0 10px 0' }}>
            {registrationSuccess ? t.registrationComplete : t.title}
          </h1>
          <p style={{ margin: 0, opacity: 0.9 }}>
            {registrationSuccess ? t.successTitle : t.subtitle}
          </p>
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
                ℹ️ <strong>{t.step1}</strong> → <strong>{t.step2}</strong>
              </div>

              <h2 style={{ fontSize: '20px', marginBottom: '25px', fontWeight: 'bold' }}>
                {t.formTitle}
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
                  {t.nameLabel} *
                </label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder={t.namePlaceholder}
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
                  📍 {t.addressLabel} *
                </label>
                <textarea
                  value={formData.address}
                  onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                  placeholder={t.addressPlaceholder}
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
                  💬 {t.whatsappLabel} *
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
                    placeholder={t.whatsappPlaceholder}
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
                {loading ? `⏳ ${t.buttonSending}` : `${t.buttonNext} →`}
              </button>

              <div style={{ textAlign: 'center' }}>
                <p style={{ fontSize: '14px', color: '#666', margin: 0 }}>
                  {t.haveAccount}{' '}
                  <span style={{ color: '#667eea', fontWeight: 'bold' }}>
                    {t.checkWhatsapp}
                  </span>
                </p>
              </div>
            </form>
          ) : (
            <form onSubmit={handleVerifyOTP}>
              <h2 style={{ fontSize: '20px', marginBottom: '10px', fontWeight: 'bold' }}>
                📱 {t.otpTitle}
              </h2>
              <p style={{ fontSize: '14px', color: '#666', marginBottom: '25px' }}>
                {t.otpSubtitle}
              </p>

              {countdown > 0 && !registrationSuccess && (
                <div style={{
                  background: '#fff3cd',
                  border: '1px solid #ffc107',
                  borderRadius: '8px',
                  padding: '12px',
                  marginBottom: '20px',
                  color: '#856404',
                  fontSize: '14px',
                  textAlign: 'center'
                }}>
                  ⏱️ {t.otpExpires}: <strong>{formatCountdown(countdown)}</strong>
                </div>
              )}

              {message && (
                <div style={{
                  background: registrationSuccess ? '#e8f5e9' : '#e3f2fd',
                  border: `1px solid ${registrationSuccess ? '#81c784' : '#90caf9'}`,
                  borderRadius: '8px',
                  padding: '15px',
                  marginBottom: '20px',
                  color: registrationSuccess ? '#2e7d32' : '#1976d2',
                  fontSize: '14px',
                  textAlign: 'center',
                  lineHeight: '1.6'
                }}>
                  {registrationSuccess && '✅'} {message}
                  {registrationSuccess && (
                    <div style={{ marginTop: '15px', padding: '12px', background: 'white', borderRadius: '8px', fontSize: '13px' }}>
                      📱 <strong>{t.nextStep}</strong><br/>
                      {devMagicLink ? (
                        <>
                          {language === 'id' ? '🔧 Mode pengujian - klik link di bawah:' : '🔧 Test mode - click link below:'}
                          <br/>
                          <a
                            href={devMagicLink}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{ color: '#667eea', fontWeight: 'bold', wordBreak: 'break-all', display: 'inline-block', marginTop: '8px' }}
                          >
                            {devMagicLink}
                          </a>
                        </>
                      ) : (
                        t.openWhatsapp
                      )}
                    </div>
                  )}
                </div>
              )}

              <div style={{ marginBottom: '20px' }}>
                <input
                  type="text"
                  value={otpCode}
                  onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 4))}
                  placeholder="0000"
                  disabled={registrationSuccess}
                  style={{
                    width: '100%',
                    padding: '12px',
                    border: '2px solid #e0e0e0',
                    borderRadius: '8px',
                    fontSize: '32px',
                    textAlign: 'center',
                    letterSpacing: '12px',
                    fontFamily: 'monospace',
                    boxSizing: 'border-box',
                    opacity: registrationSuccess ? 0.5 : 1,
                    cursor: registrationSuccess ? 'not-allowed' : 'text'
                  }}
                  maxLength={4}
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
                disabled={loading || otpCode.length !== 4 || registrationSuccess}
                style={{
                  width: '100%',
                  padding: '14px',
                  background: (loading || otpCode.length !== 4 || registrationSuccess) ? '#ccc' : 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                  color: 'white',
                  border: 'none',
                  borderRadius: '8px',
                  fontSize: '16px',
                  fontWeight: 'bold',
                  cursor: (loading || otpCode.length !== 4 || registrationSuccess) ? 'not-allowed' : 'pointer',
                  marginBottom: '15px',
                  opacity: registrationSuccess ? 0.5 : 1
                }}
              >
                {loading ? `⏳ ${t.buttonVerifying}` : registrationSuccess ? `✅ ${t.registrationComplete}` : `✅ ${t.buttonVerify}`}
              </button>

              {!registrationSuccess && (
                <>
                  <div style={{ textAlign: 'center', marginBottom: '15px' }}>
                    <button
                      type="button"
                      onClick={handleResendOTP}
                      disabled={countdown > 0 || loading}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: countdown > 0 ? '#999' : '#667eea',
                        fontSize: '14px',
                        cursor: countdown > 0 ? 'not-allowed' : 'pointer',
                        textDecoration: countdown > 0 ? 'none' : 'underline'
                      }}
                    >
                      {countdown > 0 ? `${t.resendIn} ${formatCountdown(countdown)}` : `🔄 ${t.resendOtp}`}
                    </button>
                  </div>

                  <div style={{ textAlign: 'center' }}>
                    <button
                      type="button"
                      onClick={() => {
                        setStep('form');
                        setOtpCode('');
                        setError('');
                        setMessage('');
                        setCountdown(0);
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
                      ← {t.changeNumber}
                    </button>
                  </div>
                </>
              )}
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
            🎁 {t.footerBonus}
          </p>
        </div>
      </div>
    </div>
  );
}
