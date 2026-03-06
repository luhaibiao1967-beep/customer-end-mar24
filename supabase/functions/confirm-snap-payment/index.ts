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

    // Trust Snap onSuccess — verify the order belongs to this customer
    const { data: order } = await supabase
      .from('orders')
      .select('id, payment_status')
      .eq('midtrans_order_id', midtrans_order_id)
      .eq('customer_id', customer.id)
      .single()

    if (!order) throw new Error('Order not found')
    if (order.payment_status === 'paid') {
      return new Response(
        JSON.stringify({ success: true, paid: true, already_paid: true }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      )
    }

    const today = new Date().toISOString().split('T')[0]

    const { error: updateError } = await supabase
      .from('orders')
      .update({
        payment_status: 'paid',
        paid_date: today,
        payment_confirmation_type: 'qris',
      })
      .eq('id', order.id)

    if (updateError) throw new Error('Failed to update order: ' + updateError.message)

    return new Response(
      JSON.stringify({ success: true, paid: true }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    )
  } catch (error: any) {
    console.error('confirm-snap-payment error:', error)
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    )
  }
})
