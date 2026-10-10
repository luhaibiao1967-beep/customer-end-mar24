import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.0'
import { normalizeIndonesianWhatsApp } from '../_shared/phone.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
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
      throw new Error('Phone number is required')
    }
    if (!device_id || device_id.length < 8) {
      throw new Error('Device ID is required')
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseKey)

    // 1. Check if (device_id, whatsapp) is bound
    const { data: binding } = await supabase
      .from('device_whatsapp_bindings')
      .select('customer_id')
      .eq('device_id', device_id)
      .eq('whatsapp', formattedPhone)
      .single()

    if (binding?.customer_id) {
      const { data: customer, error: custErr } = await supabase
        .from('customers')
        .select('*')
        .eq('id', binding.customer_id)
        .single()

      if (!custErr && customer) {
        return new Response(
          JSON.stringify({
            success: true,
            bound: true,
            customer: {
              id: customer.id,
              name: customer.name,
              address: customer.address,
              whatsapp: customer.whatsapp,
              customer_type: customer.customer_type,
              payment_term: customer.payment_term,
              credit_limit: customer.credit_limit,
              voucher_balance: customer.voucher_balance,
              branch: customer.branch,
              discount: customer.discount,
              service_branch: customer.service_branch ?? null,
            },
            auth_token: customer.auth_token,
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
        )
      }
    }

    // 2. Not bound - check if customer exists
    const { data: customer, error: custError } = await supabase
      .from('customers')
      .select('id')
      .eq('whatsapp', formattedPhone)
      .single()

    if (customer) {
      return new Response(
        JSON.stringify({
          success: true,
          bound: false,
          needs_otp: true,
          message: 'Existing customer - verify via OTP to bind device',
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      )
    }

    // 3. New customer - need to register
    return new Response(
      JSON.stringify({
        success: true,
        bound: false,
        new_customer: true,
        message: 'Please register first',
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    )
  } catch (error: any) {
    console.error('auth-check-device-login error:', error)
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    )
  }
})
