import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.0'
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.38.0'

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

type PricingBasis = 'purchase_weighted_avg' | 'package_fallback' | 'zero_unknown'

async function resolveVoucherUnitAmount(
  supabase: SupabaseClient,
  customerId: string,
  productId: string,
): Promise<{ unit_amount: number; pricing_basis: PricingBasis }> {
  const { data: purchases } = await supabase
    .from('voucher_purchase_requests')
    .select('amount_paid, qty')
    .eq('customer_id', customerId)
    .eq('product_id', productId)
    .eq('status', 'confirmed')

  let totalPaid = 0
  let totalQty = 0
  for (const r of purchases || []) {
    totalPaid += r.amount_paid ?? 0
    totalQty += r.qty ?? 0
  }
  if (totalQty > 0) {
    return {
      unit_amount: Math.floor(totalPaid / totalQty),
      pricing_basis: 'purchase_weighted_avg',
    }
  }

  const { data: pkgs } = await supabase
    .from('voucher_packages')
    .select('price, qty')
    .eq('product_id', productId)
    .eq('is_active', true)
    .order('sort_order', { ascending: true })

  if (pkgs && pkgs.length > 0) {
    const p = pkgs[0]
    const q = p.qty > 0 ? p.qty : 1
    return {
      unit_amount: Math.floor((p.price ?? 0) / q),
      pricing_basis: 'package_fallback',
    }
  }

  return { unit_amount: 0, pricing_basis: 'zero_unknown' }
}

async function insertVoucherUsageLines(
  supabase: SupabaseClient,
  params: {
    orderId: string
    customerId: string
    branch: string
    deductions: { product_id: string; quantity: number }[]
  },
): Promise<void> {
  const { orderId, customerId, branch, deductions } = params
  for (const d of deductions) {
    if (!d.quantity || d.quantity <= 0) continue
    const { unit_amount, pricing_basis } = await resolveVoucherUnitAmount(
      supabase,
      customerId,
      d.product_id,
    )
    const line_amount = d.quantity * unit_amount
    const { error } = await supabase.from('voucher_usage_ledger').insert({
      order_id: orderId,
      customer_id: customerId,
      branch,
      product_id: d.product_id,
      voucher_qty: d.quantity,
      unit_amount,
      line_amount,
      pricing_basis,
    })
    if (error) throw new Error('voucher_usage_ledger insert: ' + error.message)
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { token, order, items, payment_amount, product_deductions } = await req.json()
    if (!token) throw new Error('Token required')
    if (!order || !items || items.length === 0) throw new Error('Order data required')

    // payment_amount is the QRIS charge (shortfall after vouchers); defaults to full order total
    const qrisAmount = payment_amount ?? order.total_amount

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
      const { error: rbErr } = await supabase.from('order_items').delete().eq('order_id', newOrder.id)
      if (rbErr) console.error('Rollback failed (order_items on itemsError):', rbErr.message)
      const { error: rbOrdErr } = await supabase.from('orders').delete().eq('id', newOrder.id)
      if (rbOrdErr) console.error('Rollback failed (orders on itemsError):', rbOrdErr.message)
      throw new Error('Failed to create order items: ' + itemsError.message)
    }

    // Deduct vouchers for the portion covered by vouchers (if any)
    if (product_deductions && product_deductions.length > 0) {
      for (const deduction of product_deductions) {
        if (!deduction.quantity || deduction.quantity <= 0) continue
        const { data: row } = await supabase
          .from('customer_product_vouchers')
          .select('balance')
          .eq('customer_id', customer.id)
          .eq('product_id', deduction.product_id)
          .single()
        const current = row?.balance ?? 0
        await supabase.from('customer_product_vouchers').upsert({
          customer_id: customer.id,
          product_id: deduction.product_id,
          balance: Math.max(0, current - deduction.quantity),
        })
      }
    }

    // Create Midtrans Snap transaction (QRIS only) — charge only the shortfall amount
    const midtransOrderId = `pop_${customer.id.slice(0, 8)}_${Date.now()}`
    const mtResponse = await fetch(snapUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${btoa(serverKey + ':')}`,
      },
      body: JSON.stringify({
        transaction_details: { order_id: midtransOrderId, gross_amount: qrisAmount },
        item_details: [{ id: newOrder.id, price: qrisAmount, quantity: 1, name: 'Order Payment' }],
        customer_details: { first_name: customer.name, phone: customer.whatsapp },
        enabled_payments: ['other_qris'],
        notification_url: `${supabaseUrl}/functions/v1/midtrans-webhook`,
      }),
    })

    const mtData = await mtResponse.json()
    if (!mtData.token) {
      // Rollback: delete order_items first (FK), then order
      const { error: rbItemsErr } = await supabase.from('order_items').delete().eq('order_id', newOrder.id)
      if (rbItemsErr) console.error('Rollback failed (order_items on Midtrans failure):', rbItemsErr.message)
      const { error: rbOrderErr } = await supabase.from('orders').delete().eq('id', newOrder.id)
      if (rbOrderErr) console.error('Rollback failed (orders on Midtrans failure):', rbOrderErr.message)
      throw new Error('Midtrans error: ' + JSON.stringify(mtData))
    }

    // Save midtrans_order_id on the order
    const { error: updateMtErr } = await supabase
      .from('orders')
      .update({ midtrans_order_id: midtransOrderId })
      .eq('id', newOrder.id)
    if (updateMtErr) throw new Error('Failed to save midtrans_order_id: ' + updateMtErr.message)

    if (product_deductions && product_deductions.length > 0) {
      await insertVoucherUsageLines(supabase, {
        orderId: newOrder.id,
        customerId: customer.id,
        branch: customer.branch ?? '',
        deductions: product_deductions as { product_id: string; quantity: number }[],
      })
    }

    return new Response(
      JSON.stringify({ success: true, snap_token: mtData.token, client_key: clientKey, snap_js_url: snapJsUrl, order_id: newOrder.id, midtrans_order_id: midtransOrderId }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    )
  } catch (error: any) {
    console.error('submit-prepay-order error:', error)
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    )
  }
})
