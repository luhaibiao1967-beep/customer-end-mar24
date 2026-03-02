// src/Pages/CustomerLogin.tsx - Device binding + WhatsApp login
// 设备绑定：已绑定则静默登录，未绑定则 OTP 或注册
import React, { useState, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { supabase, SUPABASE_DEBUG } from '../supabaseClient'
import { getOrCreateDeviceId, getStoredDeviceId } from '../lib/deviceId'
import { theme } from '../theme'
import { useLanguage } from '../contexts/LanguageContext'

export default function CustomerLogin() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [phoneNumber, setPhoneNumber] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [status, setStatus] = useState<'idle' | 'new_customer'>('idle')
  const [deviceId, setDeviceId] = useState<string | null>(() => getStoredDeviceId())
  const { language, setLanguage, t } = useLanguage()

  useEffect(() => {
    const wa = searchParams.get('whatsapp') || searchParams.get('wa') || searchParams.get('phone')
    if (wa) setPhoneNumber(wa)
  }, [searchParams])

  useEffect(() => {
    if (!deviceId) getOrCreateDeviceId().then(setDeviceId)
  }, [])

  const formatPhoneNumber = (phone: string): string => {
    let cleaned = phone.replace(/\D/g, '')
    if (cleaned.startsWith('0')) cleaned = '62' + cleaned.substring(1)
    if (!cleaned.startsWith('62')) cleaned = '62' + cleaned
    return '+' + cleaned
  }

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

      if (functionError) throw functionError

      if (data.bound && data.customer && data.auth_token) {
        sessionStorage.setItem('customer', JSON.stringify(data.customer))
        sessionStorage.setItem('auth_token', data.auth_token)
        sessionStorage.setItem('authenticated', 'true')
        window.dispatchEvent(new Event('session-auth-updated'))
        navigate('/customer-home', { replace: true })
        return
      }

      if (data.needs_otp) {
        navigate(`/reauth?whatsapp=${encodeURIComponent(formattedPhone)}&device_id=${encodeURIComponent(resolvedDeviceId)}`, { replace: true })
        return
      }

      if (data.new_customer) {
        setStatus('new_customer')
      }
    } catch (err: any) {
      setError(err.message || 'Terjadi kesalahan')
    } finally {
      setLoading(false)
    }
  }

  const handleRegister = async () => {
    const id = deviceId ?? getStoredDeviceId() ?? await getOrCreateDeviceId()
    navigate(`/register?whatsapp=${encodeURIComponent(phoneNumber)}&device_id=${encodeURIComponent(id)}`)
  }

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: theme.gradientPrimary,
      padding: '20px',
    }}>
      <div style={{
        background: 'white',
        borderRadius: '20px',
        boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
        width: '100%',
        maxWidth: '420px',
        overflow: 'hidden',
      }}>
        <div style={{
          display: 'flex',
          justifyContent: 'flex-end',
          gap: '8px',
          padding: '12px 20px',
          background: '#f8f9fa',
        }}>
          <button
            onClick={() => setLanguage('id')}
            style={{
              padding: '6px 14px',
              background: language === 'id' ? theme.gradientPrimary : 'transparent',
              border: 'none',
              borderRadius: '16px',
              color: language === 'id' ? 'white' : theme.primary,
              fontWeight: 'bold',
              cursor: 'pointer',
              fontSize: '13px',
            }}
          >
            🇮🇩 ID
          </button>
          <button
            onClick={() => setLanguage('en')}
            style={{
              padding: '6px 14px',
              background: language === 'en' ? theme.gradientPrimary : 'transparent',
              border: 'none',
              borderRadius: '16px',
              color: language === 'en' ? 'white' : theme.primary,
              fontWeight: 'bold',
              cursor: 'pointer',
              fontSize: '13px',
            }}
          >
            🇬🇧 EN
          </button>
        </div>

        <div style={{
          background: theme.gradientPrimary,
          padding: '40px 20px',
          textAlign: 'center',
          color: 'white',
        }}>
          <div style={{
            width: '80px',
            height: '80px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 15px',
          }}>
            <img src="/logo.png" alt="Logo" style={{ width: '80px', height: '80px', objectFit: 'contain' }} />
          </div>
          <h1 style={{ fontSize: '28px', fontWeight: 'bold', margin: '0 0 10px 0' }}>{t('login.title')}</h1>
          <p style={{ margin: 0, opacity: 0.9 }}>{t('login.subtitle')}</p>
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
                  background: theme.gradientPrimary,
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
                  color: theme.primary,
                  border: `1px solid ${theme.primary}`,
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
                color: '#333',
              }}>
                💬 {t('login.whatsappLabel')}
              </label>
              <div style={{ position: 'relative', marginBottom: '20px' }}>
                <span style={{
                  position: 'absolute',
                  left: '15px',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  color: '#666',
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
                  background: loading ? theme.disabled : theme.gradientPrimary,
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
                  style={{ color: theme.primary, fontWeight: 'bold', textDecoration: 'underline' }}
                >
                  {t('login.registerHere')}
                </a>
              </p>
            </form>
          )}
        </div>

        {/* 调试：当前连接的 Supabase 项目 */}
        <div style={{
          padding: '8px 16px',
          background: 'rgba(0,0,0,0.1)',
          fontSize: '11px',
          color: 'rgba(255,255,255,0.8)',
          fontFamily: 'monospace',
          textAlign: 'center',
        }}>
          Supabase: {SUPABASE_DEBUG.projectRef}
          {SUPABASE_DEBUG.projectRef !== 'jzdnvdebwmuebjbergsp' && ' ⚠️'}
        </div>
      </div>
    </div>
  )
}
