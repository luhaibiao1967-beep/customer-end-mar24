// src/Pages/CustomerRegister.tsx - Bilingual with button disable after success
import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { getOrCreateDeviceId } from '../lib/deviceId';
import { theme } from '../theme';
import { useJsApiLoader, Autocomplete } from '@react-google-maps/api';
import { useLanguage } from '../contexts/LanguageContext';

const MAPS_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string;
const REGISTER_LIBRARIES: ('places')[] = ['places'];

export default function CustomerRegister() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { language, setLanguage, t } = useLanguage();
  const [step, setStep] = useState<'form' | 'otp'>('form');
  const [formData, setFormData] = useState({
    name: '',
    address: '',
    whatsapp: '',
  });
  const [addressAutocomplete, setAddressAutocomplete] = useState<google.maps.places.Autocomplete | null>(null);
  const { isLoaded: mapsLoaded } = useJsApiLoader({ googleMapsApiKey: MAPS_KEY, libraries: REGISTER_LIBRARIES });
  const [otpCode, setOtpCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [countdown, setCountdown] = useState(0);
  const [registrationSuccess, setRegistrationSuccess] = useState(false);
  const [devMagicLink, setDevMagicLink] = useState('');
  const [alreadyRegistered, setAlreadyRegistered] = useState(false);
  const [waMeUrl, setWaMeUrl] = useState('');

  const [deviceId, setDeviceId] = useState<string | null>(() => searchParams.get('device_id'));

  useEffect(() => {
    if (!deviceId) getOrCreateDeviceId().then(setDeviceId);
  }, []);

  useEffect(() => {
    const wa = searchParams.get('whatsapp') || searchParams.get('wa') || searchParams.get('phone');
    if (wa) setFormData(prev => ({ ...prev, whatsapp: wa }));
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
    setAlreadyRegistered(false);

    try {
      if (!formData.name || !formData.address || !formData.whatsapp) {
        throw new Error(t('register.errorRequired'));
      }

      const formattedWhatsApp = formatPhoneNumber(formData.whatsapp);
      const resolvedDeviceId = deviceId ?? await getOrCreateDeviceId();

      const { data: checkData } = await supabase.functions.invoke('auth-check-device-login', {
        body: { phone: formattedWhatsApp, device_id: resolvedDeviceId || 'dummy' },
      });
      if (checkData?.bound || checkData?.needs_otp) {
        setError(t('register.numberRegistered'));
        setLoading(false);
        return;
      }

      const { data, error: functionError } = await supabase.functions.invoke('auth-send-otp', {
        body: { phone: formattedWhatsApp, device_id: resolvedDeviceId }
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
    setMessage(t('register.creatingAccount'));

    try {
      const formattedWhatsApp = formatPhoneNumber(formData.whatsapp);
      const resolvedDeviceId = deviceId ?? await getOrCreateDeviceId();

      const { data, error: functionError } = await supabase.functions.invoke('auth-verify-otp', {
        body: {
          phone: formattedWhatsApp,
          otp: otpCode,
          device_id: resolvedDeviceId,
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
      setMessage(t('register.successMessage'));
      if (data.magic_link) {
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
      const resolvedDeviceId = deviceId ?? await getOrCreateDeviceId();

      const { data, error: functionError } = await supabase.functions.invoke('auth-send-otp', {
        body: { phone: formattedWhatsApp, device_id: resolvedDeviceId }
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

      setMessage(`📱 ${t('register.newOtpSent')}`);
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
      background: theme.gradientPrimary,
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
              background: language === 'id' ? theme.gradientPrimary : 'transparent',
              border: 'none',
              borderRadius: '16px',
              color: language === 'id' ? 'white' : theme.primary,
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
              background: language === 'en' ? theme.gradientPrimary : 'transparent',
              border: 'none',
              borderRadius: '16px',
              color: language === 'en' ? 'white' : theme.primary,
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
          background: theme.gradientPrimary,
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
            {registrationSuccess || alreadyRegistered ? '✅' : '👤'}
          </div>
          <h1 style={{ fontSize: '28px', fontWeight: 'bold', margin: '0 0 10px 0' }}>
            {registrationSuccess ? t('register.registrationComplete') : alreadyRegistered ? (language === 'id' ? 'Sudah Terdaftar' : 'Already Registered') : t('register.title')}
          </h1>
          <p style={{ margin: 0, opacity: 0.9 }}>
            {registrationSuccess ? t('register.successTitle') : alreadyRegistered ? (language === 'id' ? 'Link masuk dikirim ke WhatsApp Anda' : 'Login link sent to your WhatsApp') : t('register.subtitle')}
          </p>
        </div>

        {/* Content */}
        <div style={{ padding: '40px 30px' }}>
          {alreadyRegistered ? (
            <div>
              <div style={{
                background: '#e8f5e9',
                border: '1px solid #81c784',
                borderRadius: '8px',
                padding: '20px',
                marginBottom: '20px',
                color: '#2e7d32',
                fontSize: '15px',
                textAlign: 'center',
              }}>
                ✅ {t('register.alreadyRegistered')}
                <br />
                <span style={{ fontSize: '14px', opacity: 0.9 }}>
                  {t('register.loginLinkSent')}
                </span>
                {devMagicLink && (
                  <span style={{ display: 'block', marginTop: '12px', fontSize: '13px', color: '#666' }}>
                    {t('register.didntReceive')}
                  </span>
                )}
              </div>
              {devMagicLink && (
                <div style={{ marginBottom: '20px' }}>
                  {waMeUrl && (
                    <a
                      href={waMeUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        display: 'block',
                        width: '100%',
                        padding: '14px',
                        background: '#25D366',
                        color: 'white',
                        textAlign: 'center',
                        borderRadius: '8px',
                        fontWeight: 'bold',
                        textDecoration: 'none',
                        marginBottom: '12px',
                      }}
                    >
                      💬 {t('register.openChat')}
                    </a>
                  )}
                  <a
                    href={devMagicLink}
                    style={{
                      display: 'block',
                      width: '100%',
                      padding: '14px',
                      background: theme.gradientPrimary,
                      color: 'white',
                      textAlign: 'center',
                      borderRadius: '8px',
                      fontWeight: 'bold',
                      textDecoration: 'none',
                    }}
                  >
                    {t('register.enterDashboard')}
                  </a>
                </div>
              )}
              <p style={{ fontSize: '13px', color: '#999', margin: 0, textAlign: 'center' }}>
                <a
                  href="/"
                  onClick={(e) => { e.preventDefault(); navigate('/'); }}
                  style={{ color: theme.primary, textDecoration: 'underline' }}
                >
                  {t('register.backToLogin')}
                </a>
              </p>
            </div>
          ) : step === 'form' ? (
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
                ℹ️ <strong>{t('register.step1')}</strong> → <strong>{t('register.step2')}</strong>
              </div>

              <h2 style={{ fontSize: '20px', marginBottom: '25px', fontWeight: 'bold' }}>
                {t('register.formTitle')}
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
                  {t('register.nameLabel')} *
                </label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder={t('register.namePlaceholder')}
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

              {/* Address — Google Places Autocomplete */}
              <div style={{ marginBottom: '20px' }}>
                <label style={{
                  display: 'block',
                  fontSize: '14px',
                  fontWeight: '500',
                  marginBottom: '8px',
                  color: '#333'
                }}>
                  📍 {t('register.addressLabel')} *
                </label>
                {mapsLoaded ? (
                  <Autocomplete
                    onLoad={(ac) => setAddressAutocomplete(ac)}
                    onPlaceChanged={() => {
                      if (addressAutocomplete) {
                        const place = addressAutocomplete.getPlace();
                        setFormData({ ...formData, address: place.formatted_address || place.name || '' });
                      }
                    }}
                    options={{ componentRestrictions: { country: 'id' } }}
                  >
                    <input
                      type="text"
                      value={formData.address}
                      onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                      placeholder={t('register.addressPlaceholder')}
                      style={{
                        width: '100%',
                        padding: '12px 15px',
                        border: '2px solid #e0e0e0',
                        borderRadius: '8px',
                        fontSize: '16px',
                        boxSizing: 'border-box',
                      }}
                      required
                    />
                  </Autocomplete>
                ) : (
                  <input
                    type="text"
                    value={formData.address}
                    onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                    placeholder={t('register.addressPlaceholder')}
                    style={{
                      width: '100%',
                      padding: '12px 15px',
                      border: '2px solid #e0e0e0',
                      borderRadius: '8px',
                      fontSize: '16px',
                      boxSizing: 'border-box',
                    }}
                    required
                  />
                )}
                {formData.address && (
                  <p style={{ fontSize: '12px', color: '#666', margin: '4px 0 0 2px' }}>
                    ✓ {formData.address}
                  </p>
                )}
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
                  💬 {t('register.whatsappLabel')} *
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
                    placeholder={t('login.whatsappPlaceholder')}
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
                  background: loading ? theme.disabled : theme.gradientPrimary,
                  color: 'white',
                  border: 'none',
                  borderRadius: '8px',
                  fontSize: '16px',
                  fontWeight: 'bold',
                  cursor: loading ? 'not-allowed' : 'pointer',
                  marginBottom: '15px'
                }}
              >
                {loading ? `⏳ ${t('register.buttonSending')}` : `${t('register.buttonNext')} →`}
              </button>

              <div style={{ textAlign: 'center' }}>
                <p style={{ fontSize: '14px', color: '#666', margin: '0 0 8px 0' }}>
                  {t('register.haveAccount')}{' '}
                  <span style={{ color: theme.primary, fontWeight: 'bold' }}>
                    {t('register.checkWhatsapp')}
                  </span>
                </p>
                <p style={{ fontSize: '13px', color: '#999', margin: '0 0 4px 0' }}>
                  {t('register.lostLink')}{' '}
                  <a
                    href="/reauth"
                    onClick={(e) => { e.preventDefault(); navigate('/reauth'); }}
                    style={{ color: theme.primary, textDecoration: 'underline' }}
                  >
                    {t('register.getNewLink')}
                  </a>
                </p>
                <p style={{ fontSize: '13px', color: '#999', margin: 0 }}>
                  <a
                    href="/"
                    onClick={(e) => { e.preventDefault(); navigate('/'); }}
                    style={{ color: theme.primary, textDecoration: 'underline' }}
                  >
                    {t('register.backToLogin')}
                  </a>
                </p>
              </div>
            </form>
          ) : (
            <form onSubmit={handleVerifyOTP}>
              <h2 style={{ fontSize: '20px', marginBottom: '10px', fontWeight: 'bold' }}>
                📱 {t('register.otpTitle')}
              </h2>
              <p style={{ fontSize: '14px', color: '#666', marginBottom: '25px' }}>
                {t('register.otpSubtitle')}
              </p>

              {countdown > 0 && !registrationSuccess && (
                <div style={{
                  background: '#fff3cd',
                  border: `1px solid ${theme.warning}`,
                  borderRadius: '8px',
                  padding: '12px',
                  marginBottom: '20px',
                  color: '#856404',
                  fontSize: '14px',
                  textAlign: 'center'
                }}>
                  ⏱️ {t('register.otpExpires')}: <strong>{formatCountdown(countdown)}</strong>
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
                      📱 <strong>{t('register.nextStep')}</strong><br/>
                      {devMagicLink ? (
                        <>
                          {language === 'id' ? 'Atau klik link di bawah untuk langsung masuk:' : 'Or click the link below to enter directly:'}
                          <br/>
                          <a
                            href={devMagicLink}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{
                              color: theme.primary,
                              fontWeight: 'bold',
                              wordBreak: 'break-all',
                              display: 'inline-block',
                              marginTop: '8px',
                              padding: '8px 12px',
                              background: '#e8eaf6',
                              borderRadius: '8px',
                              textDecoration: 'none',
                            }}
                          >
                            🔗 {t('register.enterDashboard')}
                          </a>
                        </>
                      ) : (
                        t('register.openWhatsapp')
                      )}
                    </div>
                  )}
                </div>
              )}

              <div style={{ marginBottom: '20px' }}>
                <input
                  type="text"
                  value={otpCode}
                  onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 8))}
                  placeholder="000000"
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
                  maxLength={8}
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
                disabled={loading || otpCode.length < 4 || registrationSuccess}
                style={{
                  width: '100%',
                  padding: '14px',
                  background: (loading || otpCode.length < 4 || registrationSuccess) ? theme.disabled : theme.gradientPrimary,
                  color: 'white',
                  border: 'none',
                  borderRadius: '8px',
                  fontSize: '16px',
                  fontWeight: 'bold',
                  cursor: (loading || otpCode.length < 4 || registrationSuccess) ? 'not-allowed' : 'pointer',
                  marginBottom: '15px',
                  opacity: registrationSuccess ? 0.5 : 1
                }}
              >
                {loading ? `⏳ ${t('register.buttonVerifying')}` : registrationSuccess ? `✅ ${t('register.registrationComplete')}` : `✅ ${t('register.buttonVerify')}`}
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
                        color: countdown > 0 ? '#999' : theme.primary,
                        fontSize: '14px',
                        cursor: countdown > 0 ? 'not-allowed' : 'pointer',
                        textDecoration: countdown > 0 ? 'none' : 'underline'
                      }}
                    >
                      {countdown > 0 ? `${t('register.resendIn')} ${formatCountdown(countdown)}` : `🔄 ${t('register.resendOtp')}`}
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
                        color: theme.primary,
                        fontSize: '14px',
                        cursor: 'pointer',
                        textDecoration: 'underline'
                      }}
                    >
                      ← {t('register.changeNumber')}
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
            🎁 {t('register.footerBonus')}
          </p>
        </div>
      </div>
    </div>
  );
}
