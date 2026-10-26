// src/Pages/CustomerRegister.tsx - Bilingual with button disable after success
import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { getOrCreateDeviceId, normalizeDeviceId, resetDeviceId } from '../lib/deviceId';
import {
  otpSendFailureTranslationKey,
  parseOtpSendFailure,
  type OtpSendFailure,
} from '../lib/otpSendError';
import { theme } from '../theme';
import { useJsApiLoader, Autocomplete } from '@react-google-maps/api';
import { useLanguage } from '../contexts/LanguageContext';
import {
  getRememberPreference,
  getSafeCustomerReturnTo,
  normalizeWhatsApp,
  setRememberedLogin,
  writeCustomerSession,
} from '../lib/customerSession';

const MAPS_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string;
const REGISTER_LIBRARIES: ('places')[] = ['places'];

class OtpSendRequestError extends Error {
  failure: OtpSendFailure;

  constructor(failure: OtpSendFailure) {
    super('OTP request failed');
    this.name = 'OtpSendRequestError';
    this.failure = failure;
  }
}

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
  const [messageDetail, setMessageDetail] = useState('');
  const [countdown, setCountdown] = useState(0);
  const [sendRetryAfter, setSendRetryAfter] = useState(0);
  const [registrationSuccess, setRegistrationSuccess] = useState(false);
  const [devMagicLink, setDevMagicLink] = useState('');
  const [alreadyRegistered, setAlreadyRegistered] = useState(false);
  const [waMeUrl, setWaMeUrl] = useState('');
  const sendOtpInFlightRef = useRef(false);

  const [deviceId, setDeviceId] = useState<string | null>(() => normalizeDeviceId(searchParams.get('device_id')));
  const rememberLogin = searchParams.get('remember') == null
    ? getRememberPreference()
    : searchParams.get('remember') === '1';
  const returnTo = getSafeCustomerReturnTo(searchParams.get('returnTo'), '/place-order');
  const authNavigationParams = new URLSearchParams({
    returnTo,
    remember: rememberLogin ? '1' : '0',
    ...(formData.whatsapp ? { whatsapp: normalizeWhatsApp(formData.whatsapp) } : {}),
    ...(deviceId ? { device_id: deviceId } : {}),
  });
  const loginHref = `/?${authNavigationParams.toString()}`;
  const reauthHref = `/reauth?${authNavigationParams.toString()}`;

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

  useEffect(() => {
    if (sendRetryAfter <= 0) return;
    const timer = setTimeout(() => setSendRetryAfter(seconds => Math.max(0, seconds - 1)), 1000);
    return () => clearTimeout(timer);
  }, [sendRetryAfter]);

  const formatPhoneNumber = normalizeWhatsApp;

  const invokeSendOtp = async (phone: string, resolvedDeviceId: string) => {
    const { data, error: functionError } = await supabase.functions.invoke('auth-send-otp', {
      body: { phone, device_id: resolvedDeviceId }
    });

    if (functionError || !data?.success) {
      const failure = await parseOtpSendFailure(functionError, data);
      console.error('OTP request rejected:', {
        code: failure.code,
        kind: failure.kind,
        message: failure.message,
      });
      throw new OtpSendRequestError(failure);
    }
    return data;
  };

  const applyOtpSendFailure = (
    failure: OtpSendFailure,
    fallback: 'register.processFailed' | 'register.resendFailed',
  ) => {
    if (failure.retryAfter > 0) setSendRetryAfter(failure.retryAfter);
    if (failure.kind === 'invalid_device') {
      // Clear the rejected binding, but wait for an explicit user retry.
      resetDeviceId();
      setDeviceId(null);
    }
    setError(otpSendFailureTranslationKey(failure, fallback));
  };

  const handleSubmitForm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (sendOtpInFlightRef.current || sendRetryAfter > 0) return;
    sendOtpInFlightRef.current = true;
    setLoading(true);
    setError('');
    setMessage('');
    setMessageDetail('');
    setAlreadyRegistered(false);

    try {
      if (!formData.name || !formData.address || !formData.whatsapp) {
        throw new Error('register.errorRequired');
      }

      const formattedWhatsApp = formatPhoneNumber(formData.whatsapp);
      if (!formattedWhatsApp) {
        throw new Error('register.invalidWhatsApp');
      }
      const resolvedDeviceId = normalizeDeviceId(deviceId) ?? await getOrCreateDeviceId();
      const data = await invokeSendOtp(formattedWhatsApp, resolvedDeviceId);

      const isTestOtp = Boolean(data.dev_mode && data.otp);
      setMessage(isTestOtp ? 'register.testOtpCode' : 'register.otpSentToWhatsApp');
      setMessageDetail(isTestOtp ? String(data.otp) : formattedWhatsApp);
      setStep('otp');
      setCountdown(300);
    } catch (err: any) {
      console.error('Registration error:', err);
      if (err instanceof OtpSendRequestError) {
        applyOtpSendFailure(err.failure, 'register.processFailed');
        return;
      }
      const safeErrorKeys = new Set([
        'register.errorRequired',
        'register.invalidWhatsApp',
        'register.processFailed',
      ]);
      setError(safeErrorKeys.has(err?.message) ? err.message : 'register.processFailed');
    } finally {
      sendOtpInFlightRef.current = false;
      setLoading(false);
    }
  };

  const handleVerifyOTP = async (e: React.FormEvent) => {
    e.preventDefault();
    if (registrationSuccess) return; // Prevent double submission

    setLoading(true);
    setError('');
    setMessage('register.creatingAccount');
    setMessageDetail('');

    try {
      const formattedWhatsApp = formatPhoneNumber(formData.whatsapp);
      if (!formattedWhatsApp) {
        throw new Error('register.invalidWhatsApp');
      }
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

      if (functionError) {
        let errMsg = data?.error || functionError.message;
        let errCode = data?.code;
        if (functionError instanceof FunctionsHttpError && functionError.context) {
          try {
            const body = await functionError.context.json();
            errMsg = body?.error || errMsg;
            errCode = body?.code || errCode;
          } catch (_) {}
        }
        console.error('OTP verification rejected:', { errCode, errMsg });
        const invalidOtp = errCode === 'INVALID_OR_EXPIRED_OTP' || errCode === 'OTP_INPUT_REQUIRED';
        throw new Error(invalidOtp ? 'reauth.invalidOtp' : 'register.registrationFailed');
      }
      if (!data?.success) {
        console.error('OTP verification rejected:', data);
        const invalidOtp = data?.code === 'INVALID_OR_EXPIRED_OTP' || data?.code === 'OTP_INPUT_REQUIRED';
        throw new Error(invalidOtp ? 'reauth.invalidOtp' : 'register.registrationFailed');
      }
      if (!data.customer || !data.auth_token) {
        throw new Error('register.sessionUnavailable');
      }

      writeCustomerSession(data.customer, data.auth_token);
      setRememberedLogin(formattedWhatsApp, rememberLogin);
      setRegistrationSuccess(true);
      setMessage('register.registrationRedirecting');
      setMessageDetail('');
      window.dispatchEvent(new Event('session-auth-updated'));
      setLoading(false);
      setTimeout(() => navigate(returnTo, { replace: true }), 500);

    } catch (err: any) {
      console.error('❌ Registration error:', err);
      const safeErrorKeys = new Set([
        'register.invalidWhatsApp',
        'register.sessionUnavailable',
        'register.registrationFailed',
        'reauth.invalidOtp',
      ]);
      setError(safeErrorKeys.has(err?.message) ? err.message : 'register.registrationFailed');
      setLoading(false);
    }
  };

  const handleResendOTP = async () => {
    if (countdown > 0 || sendRetryAfter > 0 || registrationSuccess || sendOtpInFlightRef.current) return;

    sendOtpInFlightRef.current = true;
    setLoading(true);
    setError('');
    setMessage('register.resendingOtp');
    setMessageDetail('');

    try {
      const formattedWhatsApp = formatPhoneNumber(formData.whatsapp);
      if (!formattedWhatsApp) {
        throw new Error('register.invalidWhatsApp');
      }
      const resolvedDeviceId = normalizeDeviceId(deviceId) ?? await getOrCreateDeviceId();
      const data = await invokeSendOtp(formattedWhatsApp, resolvedDeviceId);

      const isTestOtp = Boolean(data.dev_mode && data.otp);
      setMessage(isTestOtp ? 'register.testOtpCode' : 'register.newOtpSent');
      setMessageDetail(isTestOtp ? String(data.otp) : '');
      setCountdown(300);
      setOtpCode('');
    } catch (err: any) {
      console.error('OTP resend failed:', err);
      if (err instanceof OtpSendRequestError) {
        applyOtpSendFailure(err.failure, 'register.resendFailed');
        return;
      }
      const safeErrorKeys = new Set([
        'register.invalidWhatsApp',
        'register.resendFailed',
      ]);
      setError(safeErrorKeys.has(err?.message) ? err.message : 'register.resendFailed');
    } finally {
      sendOtpInFlightRef.current = false;
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
          padding: '16px 20px',
          textAlign: 'center',
          color: 'white'
        }}>
          <div style={{
            width: '180px',
            height: '180px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 8px',
          }}>
            <img src={`${import.meta.env.BASE_URL}logo.png`} alt="VividAqua" style={{ width: '180px', height: '180px', objectFit: 'contain' }} />
          </div>
          <h1 style={{ fontSize: '28px', fontWeight: 'bold', margin: '0 0 10px 0' }}>
            {registrationSuccess ? t('register.registrationComplete') : alreadyRegistered ? t('register.alreadyRegistered') : t('register.title')}
          </h1>
          <p style={{ margin: 0, opacity: 0.9 }}>
            {registrationSuccess ? t('register.successTitle') : alreadyRegistered ? t('register.loginLinkSent') : t('register.subtitle')}
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
                  href={loginHref}
                  onClick={(e) => { e.preventDefault(); navigate(loginHref); }}
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
                  ⚠️ {t(error)}{error === 'register.otpRateLimited' && sendRetryAfter > 0
                    ? ` ${sendRetryAfter} ${t('register.seconds')}`
                    : ''}
                </div>
              )}

              <button
                type="submit"
                disabled={loading || sendRetryAfter > 0}
                style={{
                  width: '100%',
                  padding: '14px',
                  background: (loading || sendRetryAfter > 0) ? theme.disabled : theme.gradientPrimary,
                  color: 'white',
                  border: 'none',
                  borderRadius: '8px',
                  fontSize: '16px',
                  fontWeight: 'bold',
                  cursor: (loading || sendRetryAfter > 0) ? 'not-allowed' : 'pointer',
                  marginBottom: '15px'
                }}
              >
                {loading
                  ? `⏳ ${t('register.buttonSending')}`
                  : sendRetryAfter > 0
                    ? `${t('register.retryIn')} ${sendRetryAfter} ${t('register.seconds')}`
                    : `${t('register.buttonNext')} →`}
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
                    href={reauthHref}
                    onClick={(e) => { e.preventDefault(); navigate(reauthHref); }}
                    style={{ color: theme.primary, textDecoration: 'underline' }}
                  >
                    {t('register.getNewLink')}
                  </a>
                </p>
                <p style={{ fontSize: '13px', color: '#999', margin: 0 }}>
                  <a
                    href={loginHref}
                    onClick={(e) => { e.preventDefault(); navigate(loginHref); }}
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
                  {registrationSuccess && '✅'} {t(message)}{messageDetail ? `: ${messageDetail}` : ''}
                  {registrationSuccess && (
                    <div style={{ marginTop: '15px', padding: '12px', background: 'white', borderRadius: '8px', fontSize: '13px' }}>
                      📱 <strong>{t('register.nextStep')}</strong><br/>
                      {devMagicLink ? (
                        <>
                          {t('register.devDirectLink')}
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
                  ⚠️ {t(error)}{error === 'register.otpRateLimited' && sendRetryAfter > 0
                    ? ` ${sendRetryAfter} ${t('register.seconds')}`
                    : ''}
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
                      disabled={countdown > 0 || sendRetryAfter > 0 || loading}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: (countdown > 0 || sendRetryAfter > 0) ? '#999' : theme.primary,
                        fontSize: '14px',
                        cursor: (countdown > 0 || sendRetryAfter > 0) ? 'not-allowed' : 'pointer',
                        textDecoration: (countdown > 0 || sendRetryAfter > 0) ? 'none' : 'underline'
                      }}
                    >
                      {countdown > 0
                        ? `${t('register.resendIn')} ${formatCountdown(countdown)}`
                        : sendRetryAfter > 0
                          ? `${t('register.retryIn')} ${sendRetryAfter} ${t('register.seconds')}`
                          : `🔄 ${t('register.resendOtp')}`}
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
                        setMessageDetail('');
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
