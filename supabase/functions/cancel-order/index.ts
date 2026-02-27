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
    const { token, order_id } = await req.json()
    if (!token) throw new Error('Token is required')
    if (!order_id) throw new Error('Order ID is required')

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseKey)

    // Validate token and get customer
    const { data: customer, error: customerError } = await supabase
      .from('customers')
      .select('id')
      .eq('auth_token', token)
      .single()

    if (customerError || !customer) throw new Error('Invalid or expired token')

    // Verify order belongs to customer and is still pending
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select('id, status, customer_id')
      .eq('id', order_id)
      .eq('customer_id', customer.id)
      .single()

    if (orderError || !order) throw new Error('Order not found')
    if (order.status !== 'pending') throw new Error('Only pending orders can be cancelled')

    // Delete order items first (cascade should handle this, but explicit is safer)
    await supabase.from('order_items').delete().eq('order_id', order_id)

    // Delete the order
    const { error: deleteError } = await supabase
      .from('orders')
      .delete()
      .eq('id', order_id)

    if (deleteError) throw new Error('Failed to cancel order: ' + deleteError.message)

    return new Response(
      JSON.stringify({ success: true }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    )
  } catch (error: any) {
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    )
  }
})
