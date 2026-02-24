import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.0'
import { sendOTPViaFazpass } from '../_shared/fazpass.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const RATE_LIMIT_SECONDS = 60

const DEV_MODE = Deno.env.get('ENVIRONMENT') === 'development'

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const body = await req.json()
    const { phone, device_id } = body as { phone?: string; device_id?: string }

    if (!phone || phone.length < 10) {
      throw new Error('Invalid phone number')
    }

    const formattedPhone = formatPhoneNumber(phone)
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

      await supabase.from('auth_otps').insert({
        phone: formattedPhone,
        otp: otp,
        expires_at: expiresAt.toISOString(),
        verified: false,
      })

      if (device_id) {
        await supabase.from('otp_send_log').insert({ device_id, sent_at: new Date().toISOString() })
      }

      console.log(`🔧 DEV MODE: OTP for ${formattedPhone} is: ${otp}`)

      await supabase.from('whatsapp_messages').insert({
        phone: formattedPhone,
        message_type: 'otp',
        message_content: `DEV MODE - OTP: ${otp}`,
        status: 'dev_mode',
        provider_response: { dev_mode: true, otp },
      })

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
    const fazpassGatewayKey = Deno.env.get('FAZPASS_GATEWAY_KEY')!
    const fazpassMerchantKey = Deno.env.get('FAZPASS_MERCHANT_KEY')!
    const phoneForFazpass = formattedPhone.replace(/^\+/, '')
    const fazpassResponse = await sendOTPViaFazpass(
      phoneForFazpass,
      fazpassGatewayKey,
      fazpassMerchantKey
    )

    if (!fazpassResponse.success) {
      throw new Error(`Fazpass failed: ${fazpassResponse.data?.message || 'Unknown error'}`)
    }

    const d = fazpassResponse.data?.data
    const otpFromFazpass = d?.otp ?? fazpassResponse.data?.otp ?? d?.otp_code
    const requestId = d?.id ?? d?.request_id ?? d?.ref_id ?? d?.ref ?? fazpassResponse.data?.request_id ?? fazpassResponse.data?.ref

    if (!otpFromFazpass) {
      console.error('Fazpass response structure:', JSON.stringify(Object.keys(fazpassResponse.data || {})))
      throw new Error('Failed to get OTP from Fazpass')
    }

    const expiresAt = new Date(Date.now() + 5 * 60 * 1000)
    const otpToStore = String(otpFromFazpass).trim()

    const insertPayload: Record<string, unknown> = {
      phone: formattedPhone,
      otp: otpToStore,
      expires_at: expiresAt.toISOString(),
      verified: false,
    }
    if (requestId) insertPayload.request_id = String(requestId)
    let { error: otpError } = await supabase.from('auth_otps').insert(insertPayload)
    if (otpError && requestId) {
      delete insertPayload.request_id
      const retry = await supabase.from('auth_otps').insert(insertPayload)
      otpError = retry.error
    }
    if (otpError) throw otpError

    if (device_id) {
      await supabase.from('otp_send_log').insert({ device_id, sent_at: new Date().toISOString() })
    }

    await supabase.from('whatsapp_messages').insert({
      phone: formattedPhone,
      message_type: 'otp',
      message_content: `OTP: ${otpFromFazpass}`,
      status: 'sent',
      provider_response: fazpassResponse.data ?? {},
    })

    return new Response(
      JSON.stringify({
        success: true,
        message: 'OTP sent successfully',
        expires_in: 300,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    )
  } catch (error: any) {
    console.error('Error:', error)
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    )
  }
})

function formatPhoneNumber(phone: string): string {
  let cleaned = phone.replace(/\D/g, '')
  if (cleaned.startsWith('0')) cleaned = '62' + cleaned.substring(1)
  if (!cleaned.startsWith('62')) cleaned = '62' + cleaned
  return '+' + cleaned
}
