import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    if (req.method !== 'POST') throw new Error('Method not allowed')

    const { token } = await req.json()
    if (!token || typeof token !== 'string') throw new Error('Token is required')

    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if (!supabaseUrl || !supabaseKey) throw new Error('Server configuration is incomplete')

    const supabase = createClient(supabaseUrl, supabaseKey)

    const { data: customer, error: customerError } = await supabase
      .from('customers')
      .select('id, customer_type, is_active')
      .eq('auth_token', token)
      .single()

    if (customerError || !customer || customer.is_active === false) {
      throw new Error('Invalid or expired token')
    }

    if (customer.customer_type !== 'pre_pay') {
      return new Response(
        JSON.stringify({ success: true, vouchers: [] }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 },
      )
    }

    const { data: vouchers, error: vouchersError } = await supabase
      .from('customer_product_vouchers')
      .select('product_id, balance, gift_balance, products(name)')
      .eq('customer_id', customer.id)
      .order('product_id')

    if (vouchersError) throw new Error('Failed to load vouchers: ' + vouchersError.message)

    return new Response(
      JSON.stringify({ success: true, vouchers: vouchers || [] }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 },
    )
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    return new Response(
      JSON.stringify({ success: false, error: message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 },
    )
  }
})
