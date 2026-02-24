import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.0'
import { buildBodyParams, buildButtonUrlComponents, sendTemplateMessage } from '../_shared/whatsappCloud.ts'

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
    const body = await req.json()
    const { phone }: RequestBody = body
    console.log('[auth-check-and-send-link] Request:', { phone: phone ? `${phone.slice(0, 6)}***` : 'missing' })

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

      try {
        const simpleTemplate = Deno.env.get('WA_TEMPLATE_MAGIC_LINK_SIMPLE') || ''
        if (!templateName && !simpleTemplate) {
          console.error('WA_TEMPLATE_MAGIC_LINK or WA_TEMPLATE_MAGIC_LINK_SIMPLE not set')
          messageSent = false
          await supabase.from('whatsapp_messages').insert({
            customer_id: customer.id,
            phone: customer.whatsapp,
            message_type: 'login_link',
            message_content: message,
            status: 'failed',
            provider_response: JSON.stringify({ error: 'WA_TEMPLATE_MAGIC_LINK not set' }),
          })
        } else {
          // magic_link_simple: body [name, link]. magic_link_login/button: button URL only.
          const useTemplate = simpleTemplate || templateName
          const useComponents = simpleTemplate
            ? buildBodyParams([customer.name, magicLink])
            : buildButtonUrlComponents(magicLink)
          const result = await sendTemplateMessage({
            to: customer.whatsapp,
            templateName: useTemplate,
            languageCode,
            components: useComponents,
          })

          messageSent = result.ok
          if (result.ok) {
            console.log('WhatsApp send OK, message_id:', result.data?.messages?.[0]?.id)
          } else {
            console.error('WhatsApp send failed:', result.status, result.data)
          }

          const { error: insertErr } = await supabase.from('whatsapp_messages').insert({
            customer_id: customer.id,
            phone: customer.whatsapp,
            message_type: 'login_link',
            message_content: message,
            status: result.ok ? 'sent' : 'failed',
            provider_response: JSON.stringify(result.data),
          })
          if (insertErr) console.error('whatsapp_messages insert failed:', insertErr)
        }
      } catch (sendErr: any) {
        console.error('WhatsApp send error:', sendErr)
        messageSent = false
        await supabase.from('whatsapp_messages').insert({
          customer_id: customer.id,
          phone: customer.whatsapp,
          message_type: 'login_link',
          message_content: message,
          status: 'failed',
          provider_response: JSON.stringify({ error: sendErr?.message }),
        })
      }
    }

    const waBusinessNumber = Deno.env.get('WA_BUSINESS_WHATSAPP_NUMBER') || ''
    const waMeUrl = waBusinessNumber ? `https://wa.me/${waBusinessNumber.replace(/\D/g, '')}` : null

    return new Response(
      JSON.stringify({
        success: true,
        exists: true,
        message_sent: messageSent,
        message: 'Magic link sent to your WhatsApp. Please click the link to enter.',
        dev_mode: DEV_MODE,
        magic_link: magicLink, // Always return so user can click if WhatsApp not received
        wa_me_url: waMeUrl, // Open chat with business to find the message
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
