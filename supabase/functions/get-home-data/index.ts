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
    const { token } = await req.json()
    if (!token) throw new Error('Token is required')

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseKey)

    // Validate token → get customer
    const { data: customer, error: custErr } = await supabase
      .from('customers')
      .select('id, customer_type, payment_term')
      .eq('auth_token', token)
      .single()

    if (custErr || !customer) throw new Error('Invalid or expired token')

    // Run queries in parallel
    const [lastDeliveryResult, unpaidResult, pendingResult] = await Promise.all([
      // Last delivery date
      supabase
        .from('orders')
        .select('delivery_date')
        .eq('customer_id', customer.id)
        .eq('status', 'delivered')
        .order('delivery_date', { ascending: false })
        .limit(1)
        .maybeSingle(),

      // Unpaid amount (later_pay only)
      customer.customer_type !== 'pre_pay'
        ? supabase
            .from('orders')
            .select('total_amount')
            .eq('customer_id', customer.id)
            .eq('status', 'delivered')
            .eq('payment_status', 'unpaid')
        : Promise.resolve({ data: [] }),

      // Pending/scheduled orders
      supabase
        .from('orders')
        .select('id, delivery_date, status, total_amount, created_at')
        .eq('customer_id', customer.id)
        .in('status', ['pending', 'scheduled'])
        .order('created_at', { ascending: false }),
    ])

    const unpaidAmount = (unpaidResult.data || []).reduce(
      (sum: number, o: any) => sum + (o.total_amount || 0), 0
    )

    return new Response(
      JSON.stringify({
        success: true,
        last_delivery_date: lastDeliveryResult.data?.delivery_date ?? null,
        unpaid_amount: unpaidAmount,
        payment_term: customer.payment_term || 'daily',
        pending_orders: pendingResult.data || [],
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
