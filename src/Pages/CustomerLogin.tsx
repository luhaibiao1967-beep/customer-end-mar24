// src/Pages/CustomerLogin.tsx - Device binding + WhatsApp login
// 设备绑定：已绑定则静默登录，未绑定则 OTP 或注册
import React, { useState, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { FunctionsHttpError } from '@supabase/supabase-js'
import { supabase } from '../supabaseClient'
import { getOrCreateDeviceId, getStoredDeviceId } from '../lib/deviceId'
import { theme } from '../theme'
import { useLanguage } from '../contexts/LanguageContext'
import { useColorTokens } from '../contexts/ColorTokensContext'
import InstallAppModal from '../Components/InstallAppModal'
import { canShowPwaInstallPrompt, consumeLogoutPwaPromptFlag } from '../utils/pwaInstall'
import {
  getRememberPreference,
  getRememberedWhatsApp,
  getSafeCustomerReturnTo,
  normalizeWhatsApp,
  setRememberedLogin,
  writeCustomerSession,
} from '../lib/customerSession'

export default function CustomerLogin() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [phoneNumber, setPhoneNumber] = useState(() => getRememberedWhatsApp() ?? '')
  const [rememberMe, setRememberMe] = useState(() => getRememberPreference())
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [status, setStatus] = useState<'idle' | 'new_customer'>('idle')
  const [deviceId, setDeviceId] = useState<string | null>(() => getStoredDeviceId())
  const [pwaInstallOpen, setPwaInstallOpen] = useState(false)
  const { language, setLanguage, t } = useLanguage()
  const { tokens } = useColorTokens()
  const returnTo = getSafeCustomerReturnTo(searchParams.get('returnTo'))

  useEffect(() => {
    const wa = searchParams.get('whatsapp') || searchParams.get('wa') || searchParams.get('phone')
    if (wa) setPhoneNumber(wa)
  }, [searchParams])

  useEffect(() => {
    if (!deviceId) getOrCreateDeviceId().then(setDeviceId)
  }, [])

  useEffect(() => {
    if (consumeLogoutPwaPromptFlag() && canShowPwaInstallPrompt()) {
      setPwaInstallOpen(true)
    }
  }, [])

  const formatPhoneNumber = normalizeWhatsApp

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    setStatus('idle')

    try {
      const formattedPhone = formatPhoneNumber(phoneNumber)
      const resolvedDeviceId = deviceId ?? await getOrCreateDeviceId()

      const { data, error: functionError } = await supabase.functions.invoke('auth-check-device-login', {
        body: { phone: formattedPhone, device_id: resolvedDeviceId },
      })

      if (functionError) {
        if (functionError instanceof FunctionsHttpError && functionError.context?.status === 401) {
          throw new Error('__LOGIN_401__')
        }
        throw functionError
      }

      if (data.bound && data.customer && data.auth_token) {
        writeCustomerSession(data.customer, data.auth_token)
        setRememberedLogin(formattedPhone, rememberMe)
        window.dispatchEvent(new Event('session-auth-updated'))
        navigate(returnTo, { replace: true })
        return
      }

      if (data.needs_otp) {
        setRememberedLogin(formattedPhone, rememberMe)
        const params = new URLSearchParams({
          whatsapp: formattedPhone,
          device_id: resolvedDeviceId,
          remember: rememberMe ? '1' : '0',
          returnTo,
        })
        navigate(`/reauth?${params.toString()}`, { replace: true })
        return
      }

      if (data.new_customer) {
        setStatus('new_customer')
      }
    } catch (err: any) {
      if (err?.message === '__LOGIN_401__') {
        setError(t('login.functions401'))
        return
      }
      const fetchFailed =
        err?.name === 'FunctionsFetchError' ||
        (typeof err?.message === 'string' &&
          err.message.includes('Failed to send a request to the Edge Function'))
      setError(fetchFailed ? t('login.functionsUnreachable') : err.message || 'Terjadi kesalahan')
    } finally {
      setLoading(false)
    }
  }

  const handleRegister = async () => {
    const id = deviceId ?? getStoredDeviceId() ?? await getOrCreateDeviceId()
    const formattedPhone = formatPhoneNumber(phoneNumber)
    setRememberedLogin(formattedPhone, rememberMe)
    const params = new URLSearchParams({
      whatsapp: formattedPhone,
      device_id: id,
      remember: rememberMe ? '1' : '0',
      returnTo,
    })
    navigate(`/register?${params.toString()}`)
  }

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: tokens.pageBg,
      padding: '20px',
    }}>
      <div style={{
        background: tokens.card,
        borderRadius: '20px',
        boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
        width: '100%',
        maxWidth: '420px',
        overflow: 'hidden',
        backdropFilter: tokens.cardBlur,
        WebkitBackdropFilter: tokens.cardBlur,
      }}>
        <div style={{
          display: 'flex',
          justifyContent: 'flex-end',
          gap: '8px',
          padding: '12px 20px',
          background: tokens.inputBg,
        }}>
          <button
            type="button"
            onClick={() => setLanguage('id')}
            style={{
              padding: '6px 14px',
              background: language === 'id' ? tokens.gradientPrimary : 'transparent',
              border: 'none',
              borderRadius: '16px',
              color: language === 'id' ? 'white' : tokens.primary,
              fontWeight: 'bold',
              cursor: 'pointer',
              fontSize: '13px',
            }}
          >
            🇮🇩 ID
          </button>
          <button
            type="button"
            onClick={() => setLanguage('en')}
            style={{
              padding: '6px 14px',
              background: language === 'en' ? tokens.gradientPrimary : 'transparent',
              border: 'none',
              borderRadius: '16px',
              color: language === 'en' ? 'white' : tokens.primary,
              fontWeight: 'bold',
              cursor: 'pointer',
              fontSize: '13px',
            }}
          >
            🇬🇧 EN
          </button>
        </div>

        <div style={{
          background: tokens.gradientPrimary,
          padding: '24px 20px',
          textAlign: 'center',
          color: 'white',
          position: 'relative',
        }}>
          <img
            src={`${import.meta.env.BASE_URL}logo.png`}
            alt="VIVIDAQUA"
            style={{ width: '160px', height: '160px', objectFit: 'contain', margin: '0 auto 12px', display: 'block' }}
          />
          <h1 style={{ fontSize: '26px', fontWeight: '800', margin: '0 0 6px 0', letterSpacing: '0.5px' }}>{t('login.title')}</h1>
          <p style={{ margin: 0, opacity: 0.85, fontSize: '14px' }}>{t('login.subtitle')}</p>
        </div>

        <div style={{ padding: '40px 30px' }}>
          {status === 'new_customer' ? (
            <div>
              <div style={{
                background: '#fff3e0',
                border: '1px solid #ffb74d',
                borderRadius: '8px',
                padding: '20px',
                marginBottom: '20px',
                color: '#e65100',
                fontSize: '15px',
                textAlign: 'center',
              }}>
                ℹ️ {t('login.notRegistered')}
              </div>
              <button
                type="button"
                onClick={handleRegister}
                style={{
                  width: '100%',
                  padding: '14px',
                  background: tokens.gradientPrimary,
                  color: 'white',
                  border: 'none',
                  borderRadius: '8px',
                  fontSize: '16px',
                  fontWeight: 'bold',
                  cursor: 'pointer',
                }}
              >
                {t('login.register')}
              </button>
              <button
                type="button"
                onClick={() => setStatus('idle')}
                style={{
                  width: '100%',
                  padding: '12px',
                  marginTop: '12px',
                  background: 'transparent',
                  color: tokens.primary,
                  border: `1px solid ${tokens.primary}`,
                  borderRadius: '8px',
                  fontSize: '14px',
                  cursor: 'pointer',
                }}
              >
                {t('login.tryOtherNumber')}
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit}>
              <label style={{
                display: 'block',
                fontSize: '14px',
                fontWeight: '500',
                marginBottom: '8px',
                color: tokens.text,
              }}>
                💬 {t('login.whatsappLabel')}
              </label>
              <div style={{ position: 'relative', marginBottom: '20px' }}>
                <span style={{
                  position: 'absolute',
                  left: '15px',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  color: tokens.muted,
                  fontSize: '16px',
                }}>
                  +62
                </span>
                <input
                  type="tel"
                  value={phoneNumber}
                  onChange={(e) => setPhoneNumber(e.target.value)}
                  placeholder={t('login.whatsappPlaceholder')}
                  style={{
                    width: '100%',
                    padding: '12px 15px 12px 55px',
                    border: '2px solid #e0e0e0',
                    borderRadius: '8px',
                    fontSize: '16px',
                    boxSizing: 'border-box',
                  }}
                  required
                />
              </div>

              <label style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                margin: '-4px 0 20px',
                color: tokens.text,
                fontSize: '14px',
                cursor: 'pointer',
              }}>
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(event) => setRememberMe(event.target.checked)}
                  style={{ width: '18px', height: '18px', accentColor: tokens.primary }}
                />
                {language === 'id'
                  ? 'Ingat nomor saya di perangkat ini'
                  : 'Remember my number on this device'}
              </label>

              {error && (
                <div style={{
                  background: '#fee',
                  border: '1px solid #fcc',
                  borderRadius: '8px',
                  padding: '12px',
                  marginBottom: '20px',
                  color: '#c00',
                  fontSize: '14px',
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
                  background: loading ? theme.disabled : tokens.gradientPrimary,
                  color: 'white',
                  border: 'none',
                  borderRadius: '8px',
                  fontSize: '16px',
                  fontWeight: 'bold',
                  cursor: loading ? 'not-allowed' : 'pointer',
                  marginBottom: '16px',
                }}
              >
                {loading ? `⏳ ${t('login.checking')}` : t('login.continue')}
              </button>
              <p style={{ textAlign: 'center', fontSize: '14px', color: '#666', margin: 0 }}>
                {t('login.noAccount')}{' '}
                <a
                  href="/register"
                  onClick={(e) => { e.preventDefault(); navigate('/register'); }}
                  style={{ color: tokens.primary, fontWeight: 'bold', textDecoration: 'underline' }}
                >
                  {t('login.registerHere')}
                </a>
              </p>
            </form>
          )}
        </div>

        {/* 调试：当前连接的 Supabase 项目 */}
      </div>

      <InstallAppModal open={pwaInstallOpen} onClose={() => setPwaInstallOpen(false)} />
    </div>
  )
}
