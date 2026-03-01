import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { token, type, package_id, order_ids } = await req.json()
    if (!token) throw new Error('Token required')
    if (!type) throw new Error('type required: voucher | order')

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const serverKey = Deno.env.get('MIDTRANS_SERVER_KEY')!
    const midtransEnv = Deno.env.get('MIDTRANS_ENV') || 'sandbox'
    const coreApiUrl = midtransEnv === 'production'
      ? 'https://api.midtrans.com/v2/charge'
      : 'https://api.sandbox.midtrans.com/v2/charge'

    const supabase = createClient(supabaseUrl, supabaseKey)

    // Validate token
    const { data: customer } = await supabase
      .from('customers')
      .select('id, name, whatsapp')
      .eq('auth_token', token)
      .single()
    if (!customer) throw new Error('Invalid token')

    let orderId: string
    let grossAmount: number
    let itemDetails: any[]

    if (type === 'voucher') {
      if (!package_id) throw new Error('package_id required')

      const { data: pkg } = await supabase
        .from('voucher_packages')
        .select('id, product_id, qty, price, label, products(name)')
        .eq('id', package_id)
        .eq('is_active', true)
        .single()
      if (!pkg) throw new Error('Package not found')

      orderId = `vpc_${customer.id.slice(0, 8)}_${Date.now()}`
      grossAmount = pkg.price
      itemDetails = [{
        id: pkg.id,
        price: pkg.price,
        quantity: 1,
        name: `${pkg.qty} Voucher ${(pkg.products as any)?.name ?? ''}`,
      }]

      // Save purchase request
      const { error: insertError } = await supabase.from('voucher_purchase_requests').insert({
        customer_id: customer.id,
        product_id: pkg.product_id,
        qty: pkg.qty,
        amount_paid: pkg.price,
        midtrans_order_id: orderId,
        status: 'pending',
      })
      if (insertError) throw new Error('Failed to save purchase request: ' + insertError.message)

    } else if (type === 'order') {
      if (!order_ids || order_ids.length === 0) throw new Error('order_ids required')

      const { data: orders } = await supabase
        .from('orders')
        .select('id, total_amount')
        .in('id', order_ids)
        .eq('customer_id', customer.id)
        .eq('payment_status', 'unpaid')
      if (!orders || orders.length === 0) throw new Error('No valid unpaid orders found')

      grossAmount = orders.reduce((sum: number, o: any) => sum + o.total_amount, 0)
      orderId = `op_${customer.id.slice(0, 8)}_${Date.now()}`
      itemDetails = orders.map((o: any) => ({
        id: o.id,
        price: o.total_amount,
        quantity: 1,
        name: `Order #${o.id.slice(0, 8)}`,
      }))

      // Tag orders with midtrans_order_id
      await supabase
        .from('orders')
        .update({ midtrans_order_id: orderId })
        .in('id', order_ids)

    } else {
      throw new Error('Invalid type')
    }

    // Call Midtrans Core API — QRIS
    const mtResponse = await fetch(coreApiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${btoa(serverKey + ':')}`,
      },
      body: JSON.stringify({
        payment_type: 'qris',
        transaction_details: {
          order_id: orderId,
          gross_amount: grossAmount,
        },
        item_details: itemDetails,
        customer_details: {
          first_name: customer.name,
          phone: customer.whatsapp,
        },
        qris: { acquirer: 'gopay' },
      }),
    })

    const mtData = await mtResponse.json()

    // Extract QR code URL from actions array
    const qrAction = mtData.actions?.find((a: any) => a.name === 'generate-qr-code')
    if (!qrAction?.url) throw new Error('Midtrans QRIS error: ' + JSON.stringify(mtData))

    return new Response(
      JSON.stringify({
        success: true,
        qr_code_url: qrAction.url,
        qr_string: mtData.qr_string || null,
        order_id: orderId,
        amount: grossAmount,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    )

  } catch (error: any) {
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    )
  }
})
