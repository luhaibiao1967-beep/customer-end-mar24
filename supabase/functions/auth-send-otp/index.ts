import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const DEV_MODE = Deno.env.get('ENVIRONMENT') === 'development'

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { phone } = await req.json()

    if (!phone || phone.length < 10) {
      throw new Error('Invalid phone number')
    }

    const formattedPhone = formatPhoneNumber(phone)
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseKey)

    if (DEV_MODE) {
      const otp = '1234'
      const expiresAt = new Date(Date.now() + 5 * 60 * 1000)

      const { error: otpError } = await supabase
        .from('auth_otps')
        .insert({
          phone: formattedPhone,
          otp: otp,
          expires_at: expiresAt.toISOString(),
          verified: false,
        })

      if (otpError) throw otpError

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
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200,
        }
      )
    }

    // PRODUCTION MODE
    const fazpassGatewayKey = Deno.env.get('FAZPASS_GATEWAY_KEY')!
    const fazpassMerchantKey = Deno.env.get('FAZPASS_MERCHANT_KEY')!
    
    const fazpassResponse = await sendOTPViaFazpass(
      formattedPhone,
      fazpassGatewayKey,
      fazpassMerchantKey
    )

    if (!fazpassResponse.success) {
      throw new Error(`Fazpass failed: ${fazpassResponse.data?.message || 'Unknown error'}`)
    }

    const otpFromFazpass = fazpassResponse.data?.data?.otp
    
    if (!otpFromFazpass) {
      throw new Error('Failed to get OTP from Fazpass')
    }
    
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000)

    const { error: otpError } = await supabase
      .from('auth_otps')
      .insert({
        phone: formattedPhone,
        otp: otpFromFazpass.toString(),
        expires_at: expiresAt.toISOString(),
        verified: false,
      })

    if (otpError) throw otpError

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
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    )
  } catch (error: any) {
    console.error('Error:', error)
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      }
    )
  }
})

function formatPhoneNumber(phone: string): string {
  let cleaned = phone.replace(/\D/g, '')
  if (cleaned.startsWith('0')) {
    cleaned = '62' + cleaned.substring(1)
  }
  if (!cleaned.startsWith('62')) {
    cleaned = '62' + cleaned
  }
  return '+' + cleaned
}

function generateOTP(): string {
  return Math.floor(100000 + Math.random() * 900000).toString()
}

async function sendOTPViaFazpass(
  phone: string,
  gatewayKey: string,
  merchantKey: string
): Promise<any> {
  try {
    const fazpassUrl = 'https://api.fazpass.com/v1/otp/request'
    
    const response = await fetch(fazpassUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': merchantKey,
      },
      body: JSON.stringify({
        phone: phone,
        gateway_key: gatewayKey,
      }),
    })

    const data = await response.json()
    
    return {
      success: data.status === true,
      data: data,
      status: response.status,
    }
  } catch (error: any) {
    console.error('Fazpass error:', error)
    return {
      success: false,
      error: error.message,
    }
  }
}
