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

    // Validate token
    const { data: customer } = await supabase
      .from('customers')
      .select('id')
      .eq('auth_token', token)
      .single()
    if (!customer) throw new Error('Invalid token')

    let paid = false
    let status = 'pending'

    if (midtrans_order_id.startsWith('vpc_')) {
      // Voucher purchase
      const { data: req_row } = await supabase
        .from('voucher_purchase_requests')
        .select('status')
        .eq('midtrans_order_id', midtrans_order_id)
        .eq('customer_id', customer.id)
        .single()
      if (req_row) {
        status = req_row.status
        paid = req_row.status === 'confirmed'
      }
    } else if (midtrans_order_id.startsWith('op_')) {
      // Order payment — all orders with this midtrans_order_id must be paid
      const { data: orders } = await supabase
        .from('orders')
        .select('payment_status')
        .eq('midtrans_order_id', midtrans_order_id)
        .eq('customer_id', customer.id)
      if (orders && orders.length > 0) {
        const allPaid = orders.every((o: any) => o.payment_status === 'paid')
        paid = allPaid
        status = allPaid ? 'paid' : 'pending'
      }
    } else {
      throw new Error('Unknown midtrans_order_id prefix')
    }

    return new Response(
      JSON.stringify({ success: true, paid, status }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    )
  } catch (error: any) {
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    )
  }
})
