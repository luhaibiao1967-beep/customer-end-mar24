import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface OrderItem {
  product: string
  is_refill: boolean
  quantity: number
  unit_price: number
  discount: number
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { token, order, items } = await req.json()
    if (!token) throw new Error('Token required')
    if (!order || !items || items.length === 0) throw new Error('Order data required')

    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    const serverKey = Deno.env.get('MIDTRANS_SERVER_KEY')
    const clientKey = Deno.env.get('MIDTRANS_CLIENT_KEY')
    if (!supabaseUrl || !supabaseKey || !serverKey || !clientKey) {
      throw new Error('Missing required environment variables')
    }
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
      .select('id, name, address, whatsapp, branch, discount, customer_type')
      .eq('auth_token', token)
      .single()
    if (!customer) throw new Error('Invalid token')
    if (customer.customer_type !== 'pre_pay') throw new Error('Only pre_pay customers use this payment path')

    // Create order with payment_status 'unpaid'
    const { data: newOrder, error: orderError } = await supabase
      .from('orders')
      .insert({
        customer_id: customer.id,
        customer_name: customer.name,
        customer_address: customer.address,
        customer_whatsapp: customer.whatsapp,
        customer_discount: customer.discount || 0,
        branch: customer.branch,
        delivery_date: order.delivery_date,
        total_amount: order.total_amount,
        status: 'pending',
        payment_status: 'unpaid',
        note: order.note || null,
        empty_gallons_returned: 0,
        borrowed_gallons: 0,
        created_by: null,
        created_by_display: customer.name,
        is_active: true,
      })
      .select()
      .single()
    if (orderError) throw new Error('Failed to create order: ' + orderError.message)

    // Create order items
    const { error: itemsError } = await supabase.from('order_items').insert(
      items.map((item: OrderItem) => ({ ...item, order_id: newOrder.id }))
    )
    if (itemsError) {
      await supabase.from('orders').delete().eq('id', newOrder.id)
      throw new Error('Failed to create order items: ' + itemsError.message)
    }

    // Create Midtrans Snap transaction (QRIS only)
    const midtransOrderId = `pop_${customer.id.slice(0, 8)}_${Date.now()}`
    const mtResponse = await fetch(snapUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${btoa(serverKey + ':')}`,
      },
      body: JSON.stringify({
        transaction_details: { order_id: midtransOrderId, gross_amount: order.total_amount },
        item_details: items.map((item: OrderItem) => ({
          id: newOrder.id,
          price: item.unit_price,
          quantity: item.quantity,
          name: item.product.substring(0, 50),
        })),
        customer_details: { first_name: customer.name, phone: customer.whatsapp },
        enabled_payments: ['other_qris'],
        notification_url: `${supabaseUrl}/functions/v1/midtrans-webhook`,
      }),
    })

    const mtData = await mtResponse.json()
    if (!mtData.token) {
      // Rollback: delete order_items first (FK), then order
      await supabase.from('order_items').delete().eq('order_id', newOrder.id)
      await supabase.from('orders').delete().eq('id', newOrder.id)
      throw new Error('Midtrans error: ' + JSON.stringify(mtData))
    }

    // Save midtrans_order_id on the order
    await supabase.from('orders').update({ midtrans_order_id: midtransOrderId }).eq('id', newOrder.id)

    return new Response(
      JSON.stringify({ success: true, snap_token: mtData.token, client_key: clientKey, snap_js_url: snapJsUrl, order_id: newOrder.id }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    )
  } catch (error: any) {
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    )
  }
})
