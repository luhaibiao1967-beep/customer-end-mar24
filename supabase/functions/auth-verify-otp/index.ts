import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const DEV_MODE = Deno.env.get('ENVIRONMENT') === 'development'

interface RequestBody {
  phone: string
  otp: string
  name?: string
  address?: string
  isRegistration?: boolean
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { phone, otp, name, address, isRegistration }: RequestBody = await req.json()

    if (!phone || !otp) {
      throw new Error('Phone and OTP are required')
    }

    if (isRegistration && (!name || !address)) {
      throw new Error('Name and address are required for registration')
    }

    const formattedPhone = formatPhoneNumber(phone)
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseKey)

    const { data: otpRecord, error: otpError } = await supabase
      .from('auth_otps')
      .select('*')
      .eq('phone', formattedPhone)
      .eq('otp', otp)
      .eq('verified', false)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })
      .limit(1)
      .single()

    if (otpError || !otpRecord) {
      throw new Error('Invalid or expired OTP')
    }

    await supabase
      .from('auth_otps')
      .update({ verified: true })
      .eq('id', otpRecord.id)

    const { data: existingCustomer } = await supabase
      .from('customers')
      .select('*')
      .eq('whatsapp', formattedPhone)
      .single()

    let customer

    if (isRegistration) {
      if (existingCustomer) {
        throw new Error('Customer already registered. Please login instead.')
      }

      const { data: newCustomer, error: customerError } = await supabase
        .from('customers')
        .insert({
          name: name,
          address: address,
          whatsapp: formattedPhone,
          phone: formattedPhone,
          customer_type: 'pre_pay',
          voucher_balance: 5,
          discount: 0,
          branch: 'Jakarta',
          auth_token: crypto.randomUUID(),
          token_created_at: new Date().toISOString(),
          last_login_at: new Date().toISOString(),
        })
        .select()
        .single()

      if (customerError) throw customerError
      customer = newCustomer

      if (DEV_MODE) {
        console.log('🔧 DEV MODE: Skipping welcome WhatsApp message')
        console.log(`Magic link: ${Deno.env.get('APP_URL')}/home?token=${customer.auth_token}`)
      } else {
        await sendWelcomeMessage(customer, supabase)
      }

    } else {
      if (!existingCustomer) {
        throw new Error('Customer not found. Please register first.')
      }

      const { data: updatedCustomer, error: updateError } = await supabase
        .from('customers')
        .update({
          last_login_at: new Date().toISOString(),
        })
        .eq('id', existingCustomer.id)
        .select()
        .single()

      if (updateError) throw updateError
      customer = updatedCustomer
    }

    const appUrl = Deno.env.get('APP_URL') || 'https://order.waterapp.com'
    const magicLink = `${appUrl}/home?token=${customer.auth_token}`

    return new Response(
      JSON.stringify({
        success: true,
        message: isRegistration ? 'Registration successful' : 'Login successful',
        customer: {
          id: customer.id,
          name: customer.name,
          address: customer.address,
          whatsapp: customer.whatsapp,
          customer_type: customer.customer_type,
          voucher_balance: customer.voucher_balance,
          branch: customer.branch,
          discount: customer.discount,
        },
        magic_link: magicLink,
        auth_token: customer.auth_token,
        dev_mode: DEV_MODE,
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

async function sendWelcomeMessage(customer: any, supabase: any) {
  try {
    const fazpassApiKey = Deno.env.get('FAZPASS_API_KEY')!
    const fazpassMerchantKey = Deno.env.get('FAZPASS_MERCHANT_KEY')!
    const appUrl = Deno.env.get('APP_URL') || 'https://order.waterapp.com'
    const magicLink = `${appUrl}/home?token=${customer.auth_token}`

    const message = `👋 Selamat datang ${customer.name}!

Akun Anda telah aktif di layanan pengiriman air kami.
✅ Status: Aktif
🎫 Saldo voucher: ${customer.voucher_balance}

🔗 LINK PESANAN ANDA:
${magicLink}

⭐ PENTING:
- SIMPAN pesan ini dengan baik
- Klik link di atas kapan saja untuk pesan air
- TIDAK PERLU LOGIN lagi - cukup klik link!
- Link ini berlaku selamanya

Butuh bantuan? Hubungi support kami.
Terima kasih! 💧`

    const fazpassUrl = 'https://api.fazpass.com/v1/message/send'
    
    const response = await fetch(fazpassUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${fazpassApiKey}`,
        'X-Merchant-Key': fazpassMerchantKey,
      },
      body: JSON.stringify({
        phone: customer.whatsapp,
        gateway: 'whatsapp',
        message: message,
        settings: {
          sender_name: 'Water Delivery',
          is_dev: true,
        }
      }),
    })

    const data = await response.json()

    await supabase.from('whatsapp_messages').insert({
      customer_id: customer.id,
      phone: customer.whatsapp,
      message_type: 'welcome',
      message_content: message,
      status: response.ok ? 'sent' : 'failed',
      provider_response: JSON.stringify(data),
    })

    console.log('Welcome message sent:', data)
  } catch (error: any) {
    console.error('Failed to send welcome message:', error)
  }
}
