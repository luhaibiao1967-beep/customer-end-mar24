import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.0'
import { sendOTPViaFazpass } from '../_shared/fazpass.ts'
import { normalizeIndonesianWhatsApp } from '../_shared/phone.ts'
import { PROVIDER_OTP_SENTINEL } from '../_shared/otpPolicy.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Cache-Control': 'no-store, max-age=0',
  'Pragma': 'no-cache',
  'X-Content-Type-Options': 'nosniff',
}

const RATE_LIMIT_SECONDS = 60
const MAX_DEVICE_ID_LENGTH = 200
const DEV_MODE = Deno.env.get('ENVIRONMENT') === 'development'

class OtpRequestError extends Error {
  code: string
  status: number

  constructor(code: string, message: string, status = 400) {
    super(message)
    this.name = 'OtpRequestError'
    this.code = code
    this.status = status
  }
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  )
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function deterministicUuid(value: string): Promise<string> {
  const bytes = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  ).slice(0, 16)
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

async function reserveOtpRateLimit(
  supabase: any,
  deviceId: string,
  phone: string,
): Promise<{ allowed: boolean; retryAfter: number }> {
  const now = Date.now()
  const windowMs = RATE_LIMIT_SECONDS * 1000
  const cutoff = new Date(now - windowMs).toISOString()
  const [deviceHash, phoneHash] = await Promise.all([
    sha256Hex(deviceId),
    sha256Hex(phone),
  ])
  const rateKeys = [`device:${deviceHash}`, `phone:${phoneHash}`]

  const { data: recent, error: lookupError } = await supabase
    .from('otp_send_log')
    .select('sent_at')
    .in('device_id', rateKeys)
    .gte('sent_at', cutoff)
    .order('sent_at', { ascending: false })
    .limit(1)

  if (lookupError) {
    console.error('OTP rate-limit lookup failed:', lookupError)
    throw new OtpRequestError(
      'OTP_RATE_LIMIT_UNAVAILABLE',
      'Unable to safely request a verification code right now',
      503,
    )
  }

  if (recent?.length) {
    const sentAt = new Date(recent[0].sent_at).getTime()
    const retryAfter = Math.max(1, Math.ceil((sentAt + windowMs - now) / 1000))
    return { allowed: false, retryAfter }
  }

  // Deterministic IDs make simultaneous requests in the same time bucket race
  // on the primary key. Postgres inserts the pair atomically, so at most one
  // request can reserve a phone/device combination before contacting Fazpass.
  const bucket = Math.floor(now / windowMs)
  const reservationRows = await Promise.all(rateKeys.map(async (key) => ({
    id: await deterministicUuid(`otp-rate:${key}:${bucket}`),
    device_id: key,
    sent_at: new Date(now).toISOString(),
  })))
  const { error: reserveError } = await supabase
    .from('otp_send_log')
    .insert(reservationRows)

  if (reserveError?.code === '23505') {
    return { allowed: false, retryAfter: RATE_LIMIT_SECONDS }
  }
  if (reserveError) {
    console.error('OTP rate-limit reservation failed:', reserveError)
    throw new OtpRequestError(
      'OTP_RATE_LIMIT_UNAVAILABLE',
      'Unable to safely request a verification code right now',
      503,
    )
  }

  return { allowed: true, retryAfter: 0 }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders, status: 204 })
  }
  if (req.method !== 'POST') {
    return new Response(
      JSON.stringify({ success: false, code: 'METHOD_NOT_ALLOWED', error: 'Method not allowed' }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Allow': 'POST' },
        status: 405,
      },
    )
  }

  try {
    let body: any
    try {
      body = await req.json()
    } catch {
      throw new OtpRequestError('INVALID_JSON', 'Invalid JSON body')
    }
    const { phone, device_id } = body as { phone?: string; device_id?: string }

    const formattedPhone = normalizeIndonesianWhatsApp(phone)
    if (!formattedPhone) {
      throw new OtpRequestError('INVALID_PHONE', 'Invalid phone number')
    }
    const normalizedDeviceId = typeof device_id === 'string' ? device_id.trim() : ''
    if (
      normalizedDeviceId.length < 8 ||
      normalizedDeviceId.length > MAX_DEVICE_ID_LENGTH ||
      /[\u0000-\u001f\u007f]/.test(normalizedDeviceId)
    ) {
      throw new OtpRequestError('INVALID_DEVICE_ID', 'A valid device identifier is required')
    }
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseKey)

    const reservation = await reserveOtpRateLimit(supabase, normalizedDeviceId, formattedPhone)
    if (!reservation.allowed) {
      return new Response(
        JSON.stringify({
          success: false,
          code: 'OTP_RATE_LIMITED',
          error: `Please wait ${reservation.retryAfter} seconds before requesting another OTP`,
          retry_after: reservation.retryAfter,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 429 }
      )
    }

    if (DEV_MODE) {
      const otp = '1234'
      const expiresAt = new Date(Date.now() + 5 * 60 * 1000)

      const { error: otpError } = await supabase.from('auth_otps').insert({
        phone: formattedPhone,
        otp: otp,
        expires_at: expiresAt.toISOString(),
        verified: false,
      })
      if (otpError) {
        console.error('DEV OTP persistence failed:', otpError)
        throw new OtpRequestError('OTP_STORAGE_FAILED', 'Unable to prepare OTP verification', 500)
      }

      console.log(`🔧 DEV MODE: OTP for ${formattedPhone} is: ${otp}`)

      const { error: messageLogError } = await supabase.from('whatsapp_messages').insert({
        phone: formattedPhone,
        message_type: 'otp',
        message_content: `DEV MODE - OTP: ${otp}`,
        status: 'dev_mode',
        provider_response: { dev_mode: true, otp },
      })
      if (messageLogError) console.error('DEV OTP message log failed:', messageLogError)

      return new Response(
        JSON.stringify({
          success: true,
          message: 'OTP generated (DEV MODE)',
          dev_mode: true,
          otp: otp,
          expires_in: 300,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      )
    }

    // PRODUCTION - Fazpass
    const fazpassGatewayKey = Deno.env.get('FAZPASS_GATEWAY_KEY')?.trim()
    const fazpassMerchantKey = Deno.env.get('FAZPASS_MERCHANT_KEY')?.trim()
    if (!fazpassGatewayKey || !fazpassMerchantKey) {
      throw new OtpRequestError(
        'OTP_PROVIDER_NOT_CONFIGURED',
        'WhatsApp verification is temporarily unavailable',
        503
      )
    }

    const phoneForFazpass = formattedPhone.replace(/^\+/, '')
    const fazpassResponse = await sendOTPViaFazpass(
      phoneForFazpass,
      fazpassGatewayKey,
      fazpassMerchantKey
    )

    if (!fazpassResponse.success) {
      console.error('Fazpass OTP request failed:', {
        status: fazpassResponse.status,
        providerMessage: fazpassResponse.providerMessage,
        transportError: fazpassResponse.error,
      })
      const invalidResponse = fazpassResponse.error === 'missing_request_id'
      throw new OtpRequestError(
        invalidResponse ? 'OTP_PROVIDER_RESPONSE_INVALID' : 'OTP_PROVIDER_REQUEST_FAILED',
        invalidResponse
          ? 'Unable to start WhatsApp verification'
          : 'Unable to send WhatsApp verification code',
        502
      )
    }
    const requestId = fazpassResponse.requestId!

    const expiresAt = new Date(Date.now() + 5 * 60 * 1000)
    const insertPayload = {
      phone: formattedPhone,
      // Fazpass validates the submitted code. Never persist a provider-issued
      // plaintext OTP in non-development environments.
      otp: PROVIDER_OTP_SENTINEL,
      request_id: requestId,
      expires_at: expiresAt.toISOString(),
      verified: false,
    }
    const { error: otpError } = await supabase.from('auth_otps').insert(insertPayload)
    if (otpError) {
      console.error('Provider OTP persistence failed:', otpError)
      throw new OtpRequestError('OTP_STORAGE_FAILED', 'Unable to prepare OTP verification', 500)
    }

    const { error: messageLogError } = await supabase.from('whatsapp_messages').insert({
      phone: formattedPhone,
      message_type: 'otp',
      message_content: 'OTP requested via Fazpass',
      status: 'sent',
      // Keep only non-secret delivery metadata. Provider payloads may include
      // the OTP itself and therefore must not be persisted verbatim.
      provider_response: {
        provider: 'fazpass',
        request_id: requestId,
        http_status: fazpassResponse.status ?? null,
      },
    })
    if (messageLogError) console.error('OTP message log failed:', messageLogError)

    return new Response(
      JSON.stringify({
        success: true,
        message: 'OTP sent successfully',
        expires_in: 300,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    )
  } catch (error: any) {
    const publicError = error instanceof OtpRequestError
      ? error
      : new OtpRequestError('OTP_REQUEST_FAILED', 'Unable to request verification code', 500)
    console.error('auth-send-otp error:', {
      code: publicError.code,
      internalMessage: error?.message,
    })
    return new Response(
      JSON.stringify({
        success: false,
        code: publicError.code,
        error: publicError.message,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: publicError.status,
      }
    )
  }
})
