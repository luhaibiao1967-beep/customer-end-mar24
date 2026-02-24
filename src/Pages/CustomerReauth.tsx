import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import { getOrCreateDeviceId } from '../lib/deviceId'

export default function CustomerReauth() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [phoneNumber, setPhoneNumber] = useState('')
  const [otpCode, setOtpCode] = useState('')
  const [step, setStep] = useState<'phone' | 'otp'>('phone')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  const [deviceId, setDeviceId] = useState<string | null>(() => searchParams.get('device_id'))

  useEffect(() => {
    if (!deviceId) getOrCreateDeviceId().then(setDeviceId)
  }, [])

  useEffect(() => {
    const wa = searchParams.get('whatsapp') || searchParams.get('wa') || searchParams.get('phone')
    if (wa) setPhoneNumber(wa)
  }, [searchParams])

  const formatPhoneNumber = (phone: string): string => {
    let cleaned = phone.replace(/\D/g, '')
    if (cleaned.startsWith('0')) {
      cleaned = '62' + cleaned.substring(1)
    }
    if (!cleaned.startsWith('62')) {
      cleaned = '62' + cleaned
    }
    return '+' + cleaned
  }

  const handleSendOTP = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    setMessage('')

    try {
      const formattedPhone = formatPhoneNumber(phoneNumber)
      const resolvedDeviceId = deviceId ?? await getOrCreateDeviceId()

      const { data, error: functionError } = await supabase.functions.invoke('auth-send-otp', {
        body: { phone: formattedPhone, device_id: resolvedDeviceId }
      })

      if (functionError) throw functionError
      if (!data.success) throw new Error(data.error)

      setMessage('📱 OTP dikirim ke WhatsApp Anda')
      setStep('otp')
      setLoading(false)
    } catch (err: any) {
      setError(err.message || 'Gagal mengirim OTP')
      setLoading(false)
    }
  }

  const handleVerifyOTP = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')

    try {
      const formattedPhone = formatPhoneNumber(phoneNumber)
      const resolvedDeviceId = deviceId ?? await getOrCreateDeviceId()

      const { data, error: functionError } = await supabase.functions.invoke('auth-verify-otp', {
        body: {
          phone: formattedPhone,
          otp: otpCode,
          device_id: resolvedDeviceId,
          isRegistration: false,
        }
      })

      if (functionError) throw functionError
      if (!data.success) throw new Error(data.error)

      sessionStorage.setItem('customer', JSON.stringify(data.customer))
      sessionStorage.setItem('authenticated', 'true')
      if (data.auth_token) {
        sessionStorage.setItem('auth_token', data.auth_token)
      }

      // Device binding created - go directly to dashboard
      setMessage('✅ Verifikasi berhasil, mengalihkan...')
      window.dispatchEvent(new Event('session-auth-updated'))
      setTimeout(() => navigate('/customer-home', { replace: true }), 500)
      setLoading(false)
    } catch (err: any) {
      setError(err.message || 'OTP tidak valid')
      setLoading(false)
    }
  }

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
        maxWidth: '420px',
        overflow: 'hidden'
      }}>
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
            🔐
          </div>
          <h1 style={{ fontSize: '24px', fontWeight: 'bold', margin: '0 0 10px 0' }}>
            Verifikasi Ulang
          </h1>
          <p style={{ margin: 0, opacity: 0.9 }}>
            Link Anda sudah kadaluarsa, masukkan OTP
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
                Nomor WhatsApp
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
                  cursor: loading ? 'not-allowed' : 'pointer'
                }}
              >
                {loading ? '⏳ Mengirim...' : 'Kirim OTP'}
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
                  {message}
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
                  ⚠️ {error}
                </div>
              )}

              <button
                type="submit"
                disabled={loading || otpCode.length < 4}
                style={{
                  width: '100%',
                  padding: '14px',
                  background: (loading || otpCode.length < 4) ? '#ccc' : 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                  color: 'white',
                  border: 'none',
                  borderRadius: '8px',
                  fontSize: '16px',
                  fontWeight: 'bold',
                  cursor: (loading || otpCode.length < 4) ? 'not-allowed' : 'pointer'
                }}
              >
                {loading ? '⏳ Verifikasi...' : 'Verifikasi OTP'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
