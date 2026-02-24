// src/Pages/CustomerLogin.tsx - Device binding + WhatsApp login
// 设备绑定：已绑定则静默登录，未绑定则 OTP 或注册
import React, { useState, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import { getOrCreateDeviceId } from '../lib/deviceId'

type Language = 'id' | 'en'

const translations = {
  id: {
    title: 'Pesan Air',
    subtitle: 'Masukkan nomor WhatsApp Anda',
    whatsappLabel: 'Nomor WhatsApp',
    whatsappPlaceholder: '812-3456-7890',
    buttonSubmit: 'Lanjut',
    buttonLoading: 'Memeriksa...',
    newCustomer: 'Nomor belum terdaftar. Silakan daftar.',
    registerNow: 'Daftar Sekarang',
    noAccount: 'Belum punya akun?',
    registerHere: 'Daftar di sini',
    verifyOtp: 'Verifikasi via OTP',
  },
  en: {
    title: 'Order Water',
    subtitle: 'Enter your WhatsApp number',
    whatsappLabel: 'WhatsApp Number',
    whatsappPlaceholder: '812-3456-7890',
    buttonSubmit: 'Continue',
    buttonLoading: 'Checking...',
    newCustomer: 'Number not registered. Please register.',
    registerNow: 'Register Now',
    noAccount: "Don't have an account?",
    registerHere: 'Register here',
    verifyOtp: 'Verify via OTP',
  },
}

export default function CustomerLogin() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [phoneNumber, setPhoneNumber] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [status, setStatus] = useState<'idle' | 'new_customer'>('idle')
  const [deviceId] = useState(() => getOrCreateDeviceId())
  const [language, setLanguage] = useState<Language>(() => (searchParams.get('lang') === 'en' ? 'en' : 'id'))

  const t = translations[language]

  useEffect(() => {
    const wa = searchParams.get('whatsapp') || searchParams.get('wa') || searchParams.get('phone')
    if (wa) setPhoneNumber(wa)
  }, [searchParams])

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

      const { data, error: functionError } = await supabase.functions.invoke('auth-check-device-login', {
        body: { phone: formattedPhone, device_id: deviceId },
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
        navigate(`/reauth?whatsapp=${encodeURIComponent(formattedPhone)}&device_id=${encodeURIComponent(deviceId)}`, { replace: true })
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

  const handleRegister = () => {
    navigate(`/register?whatsapp=${encodeURIComponent(phoneNumber)}&device_id=${encodeURIComponent(deviceId)}`)
  }

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
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
              background: language === 'id' ? 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' : 'transparent',
              border: 'none',
              borderRadius: '16px',
              color: language === 'id' ? 'white' : '#667eea',
              fontWeight: 'bold',
              cursor: 'pointer',
              fontSize: '13px',
            }}
          >
            ID
          </button>
          <button
            onClick={() => setLanguage('en')}
            style={{
              padding: '6px 14px',
              background: language === 'en' ? 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' : 'transparent',
              border: 'none',
              borderRadius: '16px',
              color: language === 'en' ? 'white' : '#667eea',
              fontWeight: 'bold',
              cursor: 'pointer',
              fontSize: '13px',
            }}
          >
            EN
          </button>
        </div>

        <div style={{
          background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
          padding: '40px 20px',
          textAlign: 'center',
          color: 'white',
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
            fontSize: '40px',
          }}>
            💧
          </div>
          <h1 style={{ fontSize: '28px', fontWeight: 'bold', margin: '0 0 10px 0' }}>{t.title}</h1>
          <p style={{ margin: 0, opacity: 0.9 }}>{t.subtitle}</p>
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
                ℹ️ {t.newCustomer}
              </div>
              <button
                type="button"
                onClick={handleRegister}
                style={{
                  width: '100%',
                  padding: '14px',
                  background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                  color: 'white',
                  border: 'none',
                  borderRadius: '8px',
                  fontSize: '16px',
                  fontWeight: 'bold',
                  cursor: 'pointer',
                }}
              >
                {t.registerNow}
              </button>
              <button
                type="button"
                onClick={() => setStatus('idle')}
                style={{
                  width: '100%',
                  padding: '12px',
                  marginTop: '12px',
                  background: 'transparent',
                  color: '#667eea',
                  border: '1px solid #667eea',
                  borderRadius: '8px',
                  fontSize: '14px',
                  cursor: 'pointer',
                }}
              >
                Coba nomor lain
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
                💬 {t.whatsappLabel}
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
                  placeholder={t.whatsappPlaceholder}
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
                  background: loading ? '#ccc' : 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                  color: 'white',
                  border: 'none',
                  borderRadius: '8px',
                  fontSize: '16px',
                  fontWeight: 'bold',
                  cursor: loading ? 'not-allowed' : 'pointer',
                  marginBottom: '16px',
                }}
              >
                {loading ? `⏳ ${t.buttonLoading}` : t.buttonSubmit}
              </button>
              <p style={{ textAlign: 'center', fontSize: '14px', color: '#666', margin: 0 }}>
                {t.noAccount}{' '}
                <a
                  href="/register"
                  onClick={(e) => { e.preventDefault(); navigate('/register'); }}
                  style={{ color: '#667eea', fontWeight: 'bold', textDecoration: 'underline' }}
                >
                  {t.registerHere}
                </a>
              </p>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
