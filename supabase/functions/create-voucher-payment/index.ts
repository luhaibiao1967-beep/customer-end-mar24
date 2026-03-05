import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { token, package_id } = await req.json()
    if (!token) throw new Error('Token required')
    if (!package_id) throw new Error('package_id required')

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const serverKey = Deno.env.get('MIDTRANS_SERVER_KEY')!
    const clientKey = Deno.env.get('MIDTRANS_CLIENT_KEY')!
    const midtransEnv = (Deno.env.get('MIDTRANS_ENV') || 'sandbox').toLowerCase()
    const snapUrl = midtransEnv === 'production'
      ? 'https://app.midtrans.com/snap/v1/transactions'
      : 'https://app.sandbox.midtrans.com/snap/v1/transactions'

    const supabase = createClient(supabaseUrl, supabaseKey)

    // Validate token
    const { data: customer } = await supabase
      .from('customers')
      .select('id, name, whatsapp')
      .eq('auth_token', token)
      .single()
    if (!customer) throw new Error('Invalid token')

    // Load voucher package
    const { data: pkg } = await supabase
      .from('voucher_packages')
      .select('id, product_id, qty, price, label, products(name)')
      .eq('id', package_id)
      .eq('is_active', true)
      .single()
    if (!pkg) throw new Error('Package not found')

    const orderId = `vpc_${customer.id.slice(0, 8)}_${Date.now()}`

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
          gross_amount: pkg.price,
        },
        item_details: [{
          id: pkg.id,
          price: pkg.price,
          quantity: 1,
          name: `${pkg.qty} Voucher ${(pkg.products as any)?.name ?? ''}`,
        }],
        customer_details: {
          first_name: customer.name,
          phone: customer.whatsapp,
        },
        notification_url: `${supabaseUrl}/functions/v1/midtrans-webhook`,
      }),
    })

    const mtData = await mtResponse.json()
    if (!mtData.token) throw new Error('Midtrans error: ' + JSON.stringify(mtData))

    // Save purchase request
    await supabase.from('voucher_purchase_requests').insert({
      customer_id: customer.id,
      product_id: pkg.product_id,
      qty: pkg.qty,
      amount_paid: pkg.price,
      midtrans_order_id: orderId,
      status: 'pending',
    })

    return new Response(
      JSON.stringify({ success: true, snap_token: mtData.token, client_key: clientKey }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    )
  } catch (error: any) {
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    )
  }
})
