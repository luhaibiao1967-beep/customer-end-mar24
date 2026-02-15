import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.0'
import { buildBodyParams, sendTemplateMessage } from '../_shared/whatsappCloud.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const DEV_MODE = Deno.env.get('ENVIRONMENT') === 'development'

interface RequestBody {
  phone: string
}

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

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { phone }: RequestBody = await req.json()

    if (!phone) {
      throw new Error('Phone number is required')
    }

    const formattedPhone = formatPhoneNumber(phone)
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseKey)

    const { data: customer, error: customerError } = await supabase
      .from('customers')
      .select('*')
      .eq('whatsapp', formattedPhone)
      .single()

    if (customerError || !customer) {
      return new Response(
        JSON.stringify({
          success: true,
          exists: false,
          message: 'Customer not found. Please register.',
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200,
        }
      )
    }

    // Existing customer - send magic link via WhatsApp
    const appUrl = Deno.env.get('APP_URL') || 'https://order.waterapp.com'
    const magicLink = `${appUrl}/home?token=${customer.auth_token}`

    let messageSent = false

    if (DEV_MODE) {
      console.log('🔧 DEV MODE: Skipping WhatsApp send. Magic link:', magicLink)
      messageSent = true
    } else {
      const templateName = Deno.env.get('WA_TEMPLATE_MAGIC_LINK') || ''
      const languageCode = Deno.env.get('WA_TEMPLATE_LANGUAGE') || 'id'

      const message = `🔗 Link Pesanan Anda:
${magicLink}

${customer.name}, gunakan link ini untuk memesan air.

⭐ SIMPAN pesan ini!
Link ini berlaku selamanya.

Saldo voucher: ${customer.voucher_balance}

Terima kasih! 💧`

      const result = await sendTemplateMessage({
        to: customer.whatsapp,
        templateName,
        languageCode,
        components: buildBodyParams([
          customer.name,
          magicLink,
          customer.voucher_balance,
        ]),
      })

      messageSent = result.ok

      await supabase.from('whatsapp_messages').insert({
        customer_id: customer.id,
        phone: customer.whatsapp,
        message_type: 'login_link',
        message_content: message,
        status: result.ok ? 'sent' : 'failed',
        provider_response: JSON.stringify(result.data),
      })
    }

    return new Response(
      JSON.stringify({
        success: true,
        exists: true,
        message_sent: messageSent,
        message: 'Magic link sent to your WhatsApp. Please click the link to enter.',
        dev_mode: DEV_MODE,
        magic_link: DEV_MODE ? magicLink : undefined,
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
