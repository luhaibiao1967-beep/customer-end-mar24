import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.0'
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.38.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

async function insertVoucherReversalsForOrder(
  supabase: SupabaseClient,
  orderId: string,
): Promise<void> {
  const { data: rows, error: selErr } = await supabase
    .from('voucher_usage_ledger')
    .select('customer_id, branch, product_id, voucher_qty, unit_amount, line_amount, pricing_basis')
    .eq('order_id', orderId)
    .gt('voucher_qty', 0)

  if (selErr) throw new Error('voucher_usage_ledger select reversal: ' + selErr.message)
  if (!rows?.length) return

  for (const r of rows) {
    const { error } = await supabase.from('voucher_usage_ledger').insert({
      order_id: orderId,
      customer_id: r.customer_id,
      branch: r.branch,
      product_id: r.product_id,
      voucher_qty: -r.voucher_qty,
      unit_amount: r.unit_amount,
      line_amount: -r.line_amount,
      pricing_basis: r.pricing_basis,
    })
    if (error) throw new Error('voucher_usage_ledger reversal insert: ' + error.message)
  }
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
      .select('id, customer_type')
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

    await insertVoucherReversalsForOrder(supabase, order_id)

    // For pre_pay: refund vouchers back to customer (gift rows unit_price=0 → gift_balance)
    if (customer.customer_type === 'pre_pay') {
      const { data: items } = await supabase
        .from('order_items')
        .select('product, quantity, unit_price')
        .eq('order_id', order_id)

      const refundByProduct = new Map<string, { total: number; gift: number }>()

      for (const item of items || []) {
        if (!item.product || !item.quantity) continue

        const { data: product } = await supabase
          .from('products')
          .select('id')
          .eq('name', item.product)
          .single()

        if (!product) continue

        const prev = refundByProduct.get(product.id) ?? { total: 0, gift: 0 }
        prev.total += item.quantity
        if ((item.unit_price ?? 0) === 0) prev.gift += item.quantity
        refundByProduct.set(product.id, prev)
      }

      for (const [productId, { total, gift }] of refundByProduct) {
        const { data: row } = await supabase
          .from('customer_product_vouchers')
          .select('balance, gift_balance')
          .eq('customer_id', customer.id)
          .eq('product_id', productId)
          .single()

        const current = row?.balance ?? 0
        const currentGift = row?.gift_balance ?? 0

        await supabase
          .from('customer_product_vouchers')
          .upsert({
            customer_id: customer.id,
            product_id: productId,
            balance: current + total,
            gift_balance: currentGift + gift,
          })
      }
    }

    // Delete order items first
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
