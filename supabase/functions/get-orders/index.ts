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

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseKey)

    // Validate token
    const { data: customer, error: customerError } = await supabase
      .from('customers')
      .select('id, initial_borrowed_gallons')
      .eq('auth_token', token)
      .single()

    if (customerError || !customer) throw new Error('Invalid or expired token')

    // Fetch single order or all orders
    if (order_id) {
      const { data: order, error: orderError } = await supabase
        .from('orders')
        .select('*, order_items(*)')
        .eq('id', order_id)
        .eq('customer_id', customer.id)
        .single()

      if (orderError) throw new Error('Failed to fetch order: ' + orderError.message)

      return new Response(
        JSON.stringify({ success: true, order }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      )
    }

    // Fetch all orders (no order_items for list view - loaded on demand in detail view)
    const { data: orders, error: ordersError } = await supabase
      .from('orders')
      .select('id, customer_id, customer_name, customer_address, delivery_date, status, payment_status, total_amount, created_at, delivery_evidence, payment_evidence, borrowed_gallons')
      .eq('customer_id', customer.id)
      .order('created_at', { ascending: false })

    if (ordersError) throw new Error('Failed to fetch orders: ' + ordersError.message)

    return new Response(
      JSON.stringify({
        success: true,
        orders: orders || [],
        initial_borrowed_gallons: customer.initial_borrowed_gallons || 0,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    )
  } catch (error: any) {
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    )
  }
})
