import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.0'
import { sendOTPViaFazpass } from '../_shared/fazpass.ts'
import { normalizeIndonesianWhatsApp } from '../_shared/phone.ts'
import { PROVIDER_OTP_SENTINEL } from '../_shared/otpPolicy.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const RATE_LIMIT_SECONDS = 60
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

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const body = await req.json()
    const { phone, device_id } = body as { phone?: string; device_id?: string }

    const formattedPhone = normalizeIndonesianWhatsApp(phone)
    if (!formattedPhone) {
      throw new OtpRequestError('INVALID_PHONE', 'Invalid phone number')
    }
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseKey)

    // Rate limit: 60s per device_id (when device_id provided)
    if (device_id && device_id.length >= 8) {
      const cutoff = new Date(Date.now() - RATE_LIMIT_SECONDS * 1000).toISOString()
      const { data: recent } = await supabase
        .from('otp_send_log')
        .select('id')
        .eq('device_id', device_id)
        .gte('sent_at', cutoff)
        .limit(1)
      if (recent && recent.length > 0) {
        return new Response(
          JSON.stringify({
            success: false,
            code: 'OTP_RATE_LIMITED',
            error: `Please wait ${RATE_LIMIT_SECONDS} seconds before requesting another OTP`,
            retry_after: RATE_LIMIT_SECONDS,
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 429 }
        )
      }
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

      if (device_id) {
        const { error: sendLogError } = await supabase
          .from('otp_send_log')
          .insert({ device_id, sent_at: new Date().toISOString() })
        if (sendLogError) console.error('DEV OTP rate-limit log failed:', sendLogError)
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

    if (device_id) {
      const { error: sendLogError } = await supabase
        .from('otp_send_log')
        .insert({ device_id, sent_at: new Date().toISOString() })
      if (sendLogError) console.error('OTP rate-limit log failed:', sendLogError)
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
