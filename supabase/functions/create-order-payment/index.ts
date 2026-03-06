import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { token, order_ids, enabled_payments } = await req.json()
    if (!token) throw new Error('Token required')
    if (!order_ids || order_ids.length === 0) throw new Error('order_ids required')

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const serverKey = Deno.env.get('MIDTRANS_SERVER_KEY')!
    const clientKey = Deno.env.get('MIDTRANS_CLIENT_KEY')!
    const midtransEnv = (Deno.env.get('MIDTRANS_ENV') || 'sandbox').toLowerCase()
    const snapUrl = midtransEnv === 'production'
      ? 'https://app.midtrans.com/snap/v1/transactions'
      : 'https://app.sandbox.midtrans.com/snap/v1/transactions'
    const snapJsUrl = midtransEnv === 'production'
      ? 'https://app.midtrans.com/snap/snap.js'
      : 'https://app.sandbox.midtrans.com/snap/snap.js'

    const supabase = createClient(supabaseUrl, supabaseKey)

    // Validate token
    const { data: customer } = await supabase
      .from('customers')
      .select('id, name, whatsapp')
      .eq('auth_token', token)
      .single()
    if (!customer) throw new Error('Invalid token')

    // Load orders — must belong to customer and be unpaid
    const { data: orders } = await supabase
      .from('orders')
      .select('id, total_amount')
      .in('id', order_ids)
      .eq('customer_id', customer.id)
      .eq('payment_status', 'unpaid')

    if (!orders || orders.length === 0) throw new Error('No valid unpaid orders found')

    const grossAmount = orders.reduce((sum, o) => sum + o.total_amount, 0)
    const orderId = `op_${customer.id.slice(0, 8)}_${Date.now()}`

    // Create Midtrans Snap transaction
    const mtResponse = await fetch(snapUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${btoa(serverKey + ':')}`,
      },
      body: JSON.stringify({
        transaction_details: {
          order_id: orderId,
          gross_amount: grossAmount,
        },
        item_details: orders.map(o => ({
          id: o.id,
          price: o.total_amount,
          quantity: 1,
          name: `Order #${o.id.slice(0, 8)}`,
        })),
        customer_details: {
          first_name: customer.name,
          phone: customer.whatsapp,
        },
        ...(enabled_payments?.length ? { enabled_payments } : {}),
        notification_url: `${supabaseUrl}/functions/v1/midtrans-webhook`,
      }),
    })

    const mtData = await mtResponse.json()
    if (!mtData.token) throw new Error('Midtrans error: ' + JSON.stringify(mtData))

    // Tag all orders with midtrans_order_id
    await supabase
      .from('orders')
      .update({ midtrans_order_id: orderId })
      .in('id', order_ids)

    return new Response(
      JSON.stringify({ success: true, snap_token: mtData.token, client_key: clientKey, snap_js_url: snapJsUrl, total: grossAmount, midtrans_order_id: orderId }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    )
  } catch (error: any) {
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    )
  }
})
