import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface RequestBody {
  phone: string
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { phone }: RequestBody = await req.json()

    if (!phone || phone.length < 10) {
      throw new Error('Invalid phone number')
    }

    const formattedPhone = formatPhoneNumber(phone)
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseKey)

    const otp = generateOTP()
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

    const fazpassApiKey = Deno.env.get('FAZPASS_API_KEY')!
    const fazpassMerchantKey = Deno.env.get('FAZPASS_MERCHANT_KEY')!
    
    const fazpassResponse = await sendOTPViaFazpass(
      formattedPhone,
      otp,
      fazpassApiKey,
      fazpassMerchantKey
    )

    await supabase.from('whatsapp_messages').insert({
      phone: formattedPhone,
      message_type: 'otp',
      message_content: `OTP: ${otp}`,
      status: fazpassResponse.success ? 'sent' : 'failed',
      provider_response: JSON.stringify(fazpassResponse),
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
  otp: string,
  apiKey: string,
  merchantKey: string
): Promise<any> {
  try {
    const fazpassUrl = 'https://api.fazpass.com/v1/otp/request'
    const message = `Kode OTP Anda: ${otp}\nBerlaku 5 menit.\nJangan bagikan kode ini!`
    
    const response = await fetch(fazpassUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'X-Merchant-Key': merchantKey,
      },
      body: JSON.stringify({
        phone: phone,
        gateway: 'whatsapp',
        otp: otp,
        message: message,
        settings: {
          sender_name: 'Water Delivery',
          is_dev: Deno.env.get('ENVIRONMENT') !== 'production',
        }
      }),
    })

    const data = await response.json()
    
    return {
      success: response.ok,
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
