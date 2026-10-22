import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { FunctionsHttpError } from '@supabase/supabase-js'
import { supabase } from '../supabaseClient'
import { getOrCreateDeviceId } from '../lib/deviceId'
import { theme } from '../theme'
import LanguageSwitcher from '../Components/LanguageSwitcher'
import { useLanguage } from '../contexts/LanguageContext'
import {
  getRememberPreference,
  getSafeCustomerReturnTo,
  normalizeWhatsApp,
  setRememberedLogin,
  writeCustomerSession,
} from '../lib/customerSession'

async function getFunctionErrorMessage(error: unknown, data: any, fallback: string): Promise<string> {
  let message = data?.error || (error as any)?.message || fallback
  if (error instanceof FunctionsHttpError && error.context) {
    try {
      const body = await error.context.json()
      message = body?.error || message
    } catch {
      // The public fallback is sufficient when the response body is unavailable.
    }
  }
  console.error('Customer reauthentication function failed:', { error, message })
  return fallback
}

export default function CustomerReauth() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { t } = useLanguage()
  const [phoneNumber, setPhoneNumber] = useState('')
  const [otpCode, setOtpCode] = useState('')
  const [step, setStep] = useState<'phone' | 'otp'>('phone')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [devOtp, setDevOtp] = useState<string | null>(null)

  const [deviceId, setDeviceId] = useState<string | null>(() => searchParams.get('device_id'))
  const rememberLogin = searchParams.get('remember') == null
    ? getRememberPreference()
    : searchParams.get('remember') === '1'
  const returnTo = getSafeCustomerReturnTo(searchParams.get('returnTo'))

  useEffect(() => {
    if (!deviceId) getOrCreateDeviceId().then(setDeviceId)
  }, [])

  useEffect(() => {
    const wa = searchParams.get('whatsapp') || searchParams.get('wa') || searchParams.get('phone')
    if (wa) setPhoneNumber(wa)
  }, [searchParams])

  const formatPhoneNumber = normalizeWhatsApp

  const handleSendOTP = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    setMessage('')

    try {
      const formattedPhone = formatPhoneNumber(phoneNumber)
      if (!formattedPhone) throw new Error('reauth.invalidWhatsapp')
      const resolvedDeviceId = deviceId ?? await getOrCreateDeviceId()

      const { data, error: functionError } = await supabase.functions.invoke('auth-send-otp', {
        body: { phone: formattedPhone, device_id: resolvedDeviceId }
      })

      if (functionError) {
        throw new Error(await getFunctionErrorMessage(functionError, data, 'reauth.sendOtpFailed'))
      }
      if (!data?.success) {
        console.error('OTP request was rejected:', data)
        throw new Error('reauth.sendOtpFailed')
      }

      setDevOtp(data.dev_mode && data.otp ? String(data.otp) : null)
      setMessage(data.dev_mode && data.otp ? 'reauth.testOtp' : 'reauth.otpSent')
      setStep('otp')
      setLoading(false)
    } catch (err: any) {
      console.error('Unable to request customer OTP:', err)
      const safeErrorKeys = new Set(['reauth.invalidWhatsapp', 'reauth.sendOtpFailed'])
      setError(safeErrorKeys.has(err?.message) ? err.message : 'common.unexpectedError')
      setLoading(false)
    }
  }

  const handleVerifyOTP = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')

    try {
      const formattedPhone = formatPhoneNumber(phoneNumber)
      if (!formattedPhone) throw new Error('reauth.invalidWhatsapp')
      const resolvedDeviceId = deviceId ?? await getOrCreateDeviceId()

      const { data, error: functionError } = await supabase.functions.invoke('auth-verify-otp', {
        body: {
          phone: formattedPhone,
          otp: otpCode,
          device_id: resolvedDeviceId,
          isRegistration: false,
        }
      })

      if (functionError) {
        throw new Error(await getFunctionErrorMessage(functionError, data, 'reauth.invalidOtp'))
      }
      if (!data?.success) {
        console.error('OTP verification was rejected:', data)
        throw new Error('reauth.invalidOtp')
      }
      if (!data.customer || !data.auth_token) throw new Error('reauth.sessionUnavailable')

      writeCustomerSession(data.customer, data.auth_token)
      setRememberedLogin(formattedPhone, rememberLogin)

      setDevOtp(null)
      setMessage('reauth.verifySuccess')
      window.dispatchEvent(new Event('session-auth-updated'))
      setTimeout(() => navigate(returnTo, { replace: true }), 500)
      setLoading(false)
    } catch (err: any) {
      console.error('Unable to verify customer OTP:', err)
      const safeErrorKeys = new Set([
        'reauth.invalidWhatsapp',
        'reauth.invalidOtp',
        'reauth.sessionUnavailable',
      ])
      setError(safeErrorKeys.has(err?.message) ? err.message : 'common.unexpectedError')
      setLoading(false)
    }
  }

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: theme.gradientPrimary,
      padding: '20px'
    }}>
      <div style={{ position: 'fixed', top: '16px', right: '16px', zIndex: 10 }}>
        <LanguageSwitcher variant="inline" />
      </div>
      <div style={{
        background: 'white',
        borderRadius: '20px',
        boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
        width: '100%',
        maxWidth: '420px',
        overflow: 'hidden'
      }}>
        <div style={{
          background: theme.gradientPrimary,
          padding: '24px 20px',
          textAlign: 'center',
          color: 'white',
        }}>
          <img
            src={`${import.meta.env.BASE_URL}logo.png`}
            alt="VIVIDAQUA"
            style={{ width: '100px', height: '100px', objectFit: 'contain', margin: '0 auto 12px', display: 'block' }}
          />
          <h1 style={{ fontSize: '22px', fontWeight: '800', margin: '0 0 6px 0' }}>
            {step === 'phone' ? t('reauth.identityTitle') : t('reauth.otpTitle')}
          </h1>
          <p style={{ margin: 0, opacity: 0.85, fontSize: '13px' }}>
            {step === 'phone' ? t('reauth.phoneSubtitle') : t('reauth.otpSubtitle')}
          </p>
        </div>

        <div style={{ padding: '30px' }}>
          {step === 'phone' ? (
            <form onSubmit={handleSendOTP}>
              <label style={{
                display: 'block',
                fontSize: '14px',
                fontWeight: '500',
                marginBottom: '8px',
                color: '#333'
              }}>
                {t('reauth.whatsappLabel')}
              </label>
              <input
                type="tel"
                value={phoneNumber}
                onChange={(e) => setPhoneNumber(e.target.value)}
                placeholder="812-3456-7890"
                style={{
                  width: '100%',
                  padding: '12px 15px',
                  border: '2px solid #e0e0e0',
                  borderRadius: '8px',
                  fontSize: '16px',
                  boxSizing: 'border-box',
                  marginBottom: '20px'
                }}
                required
              />

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
                  ⚠️ {t(error)}
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
                  cursor: loading ? 'not-allowed' : 'pointer'
                }}
              >
                {loading ? `⏳ ${t('reauth.sending')}` : t('reauth.sendOtp')}
              </button>
            </form>
          ) : (
            <form onSubmit={handleVerifyOTP}>
              {message && (
                <div style={{
                  background: '#e3f2fd',
                  border: '1px solid #90caf9',
                  borderRadius: '8px',
                  padding: '12px',
                  marginBottom: '20px',
                  color: '#1976d2',
                  fontSize: '14px',
                  textAlign: 'center'
                }}>
                  {message && t(message)}{devOtp ? ` ${devOtp}` : ''}
                </div>
              )}

              <input
                type="text"
                value={otpCode}
                onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 8))}
                placeholder="0000"
                style={{
                  width: '100%',
                  padding: '12px',
                  border: '2px solid #e0e0e0',
                  borderRadius: '8px',
                  fontSize: '28px',
                  textAlign: 'center',
                  letterSpacing: '10px',
                  fontFamily: 'monospace',
                  boxSizing: 'border-box',
                  marginBottom: '20px'
                }}
                maxLength={8}
                required
                autoFocus
              />

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
                  ⚠️ {t(error)}
                </div>
              )}

              <button
                type="submit"
                disabled={loading || otpCode.length < 4}
                style={{
                  width: '100%',
                  padding: '14px',
                  background: (loading || otpCode.length < 4) ? theme.disabled : theme.gradientPrimary,
                  color: 'white',
                  border: 'none',
                  borderRadius: '8px',
                  fontSize: '16px',
                  fontWeight: 'bold',
                  cursor: (loading || otpCode.length < 4) ? 'not-allowed' : 'pointer'
                }}
              >
                {loading ? `⏳ ${t('reauth.verifying')}` : t('reauth.verifyOtp')}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
