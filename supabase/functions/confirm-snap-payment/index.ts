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
    const serverKey = Deno.env.get('MIDTRANS_SERVER_KEY')!
    const midtransEnv = (Deno.env.get('MIDTRANS_ENV') || 'sandbox').toLowerCase()

    const supabase = createClient(supabaseUrl, supabaseKey)

    // Validate customer token
    const { data: customer } = await supabase
      .from('customers')
      .select('id')
      .eq('auth_token', token)
      .single()
    if (!customer) throw new Error('Invalid token')

    // Verify with Midtrans API
    const midtransBaseUrl = midtransEnv === 'production'
      ? 'https://api.midtrans.com'
      : 'https://api.sandbox.midtrans.com'

    const statusRes = await fetch(`${midtransBaseUrl}/v2/${midtrans_order_id}/status`, {
      headers: { 'Authorization': `Basic ${btoa(serverKey + ':')}` },
    })
    const statusData = await statusRes.json()
    const { transaction_status, fraud_status } = statusData

    const isSuccess =
      transaction_status === 'settlement' ||
      (transaction_status === 'capture' && fraud_status === 'accept')

    if (!isSuccess) {
      return new Response(
        JSON.stringify({ success: false, paid: false, status: transaction_status }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      )
    }

    const today = new Date().toISOString().split('T')[0]

    if (midtrans_order_id.startsWith('pop_') || midtrans_order_id.startsWith('op_')) {
      await supabase
        .from('orders')
        .update({
          payment_status: 'paid',
          paid_date: today,
          payment_confirmation_type: 'qris',
        })
        .eq('midtrans_order_id', midtrans_order_id)
        .eq('payment_status', 'unpaid')
    }

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
