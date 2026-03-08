import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { token, midtrans_order_id } = await req.json()
    if (!token) throw new Error('Token required')
    if (!midtrans_order_id) throw new Error('midtrans_order_id required')

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

    const supabase = createClient(supabaseUrl, supabaseKey)

    // Validate customer token
    const { data: customer } = await supabase
      .from('customers')
      .select('id')
      .eq('auth_token', token)
      .single()
    if (!customer) throw new Error('Invalid token')

    // Atomically claim the purchase request (status pending → confirmed)
    // Security: midtrans_order_id must belong to this customer and exist in DB
    // (created by create-voucher-payment before Snap was opened)
    // This prevents double-counting if webhook also fires later
    const { data: request } = await supabase
      .from('voucher_purchase_requests')
      .update({ status: 'confirmed' })
      .eq('midtrans_order_id', midtrans_order_id)
      .eq('customer_id', customer.id)
      .eq('status', 'pending')
      .select('product_id, qty')
      .single()

    if (!request) {
      // Already confirmed (webhook beat us, or duplicate call) — just return success
      return new Response(
        JSON.stringify({ success: true, already_confirmed: true }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      )
    }

    // Update voucher balance
    const { data: existing } = await supabase
      .from('customer_product_vouchers')
      .select('balance')
      .eq('customer_id', customer.id)
      .eq('product_id', request.product_id)
      .single()

    await supabase
      .from('customer_product_vouchers')
      .upsert({
        customer_id: customer.id,
        product_id: request.product_id,
        balance: (existing?.balance ?? 0) + request.qty,
      })

    return new Response(
      JSON.stringify({ success: true }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    )
  } catch (error: any) {
    console.error('confirm-voucher-payment error:', error)
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    )
  }
})
