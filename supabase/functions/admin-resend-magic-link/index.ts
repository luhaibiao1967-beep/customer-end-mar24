import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.0'
import { buildBodyParams, sendTemplateMessage } from '../_shared/whatsappCloud.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface RequestBody {
  customer_id?: string
  phone?: string
  regenerate_token?: boolean
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { customer_id, phone, regenerate_token }: RequestBody = await req.json()

    if (!customer_id && !phone) {
      throw new Error('Either customer_id or phone is required')
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseKey)

    let query = supabase.from('customers').select('*')
    
    if (customer_id) {
      query = query.eq('id', customer_id)
    } else {
      query = query.eq('whatsapp', phone)
    }

    const { data: customer, error: customerError } = await query.single()

    if (customerError || !customer) {
      throw new Error('Customer not found')
    }

    let token = customer.auth_token

    if (regenerate_token) {
      const newToken = crypto.randomUUID()
      
      const { data: updatedCustomer, error: updateError } = await supabase
        .from('customers')
        .update({
          auth_token: newToken,
          token_created_at: new Date().toISOString(),
        })
        .eq('id', customer.id)
        .select()
        .single()

      if (updateError) throw updateError
      token = newToken
    }

    const appUrl = Deno.env.get('APP_URL') || 'https://order.waterapp.com'
    const magicLink = `${appUrl}/home?token=${token}`

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

    await supabase.from('whatsapp_messages').insert({
      customer_id: customer.id,
      phone: customer.whatsapp,
      message_type: 'resend_link',
      message_content: message,
      status: result.ok ? 'sent' : 'failed',
      provider_response: JSON.stringify(result.data),
    })

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Magic link sent successfully',
        customer: {
          id: customer.id,
          name: customer.name,
          whatsapp: customer.whatsapp,
        },
        token_regenerated: regenerate_token || false,
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
