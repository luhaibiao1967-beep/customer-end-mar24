import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { token, package_id, product_id, qty } = await req.json()
    if (!token) throw new Error('Token required')
    if (!package_id && !product_id) throw new Error('package_id or product_id required')

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

    let price: number
    let voucherProductId: string
    let voucherQty: number
    let itemName: string
    const orderId = `vpc_${customer.id.slice(0, 8)}_${Date.now()}`

    if (package_id) {
      // Package purchase path
      const { data: pkg } = await supabase
        .from('voucher_packages')
        .select('id, product_id, qty, price, label, products(name)')
        .eq('id', package_id)
        .eq('is_active', true)
        .single()
      if (!pkg) throw new Error('Package not found')
      price = pkg.price
      voucherProductId = pkg.product_id
      voucherQty = pkg.qty
      itemName = `${pkg.qty} Voucher ${(pkg.products as any)?.name ?? ''}`
    } else {
      // Custom product+qty purchase path
      const quantity = Math.max(1, qty ?? 1)
      const { data: product } = await supabase
        .from('products')
        .select('id, name, price')
        .eq('id', product_id)
        .eq('status', 'active')
        .single()
      if (!product) throw new Error('Product not found')
      price = product.price * quantity
      voucherProductId = product_id
      voucherQty = quantity
      itemName = `${quantity}x Voucher ${product.name}`
    }

    // Create Midtrans Snap transaction (QRIS only)
    const mtResponse = await fetch(snapUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${btoa(serverKey + ':')}`,
      },
      body: JSON.stringify({
        transaction_details: { order_id: orderId, gross_amount: price },
        item_details: [{ id: package_id ?? product_id, price, quantity: 1, name: itemName }],
        customer_details: { first_name: customer.name, phone: customer.whatsapp },
        enabled_payments: ['other_qris'],
        notification_url: `${supabaseUrl}/functions/v1/midtrans-webhook`,
      }),
    })

    const mtData = await mtResponse.json()
    if (!mtData.token) throw new Error('Midtrans error: ' + JSON.stringify(mtData))

    // Save purchase request (webhook uses this to credit vouchers)
    await supabase.from('voucher_purchase_requests').insert({
      customer_id: customer.id,
      product_id: voucherProductId,
      qty: voucherQty,
      amount_paid: price,
      midtrans_order_id: orderId,
      status: 'pending',
    })

    return new Response(
      JSON.stringify({ success: true, snap_token: mtData.token, client_key: clientKey, snap_js_url: snapJsUrl }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    )
  } catch (error: any) {
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    )
  }
})
