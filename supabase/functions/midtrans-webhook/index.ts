import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.0'

serve(async (req) => {
  try {
    const body = await req.json()
    const {
      order_id,
      status_code,
      gross_amount,
      signature_key,
      transaction_status,
      fraud_status,
    } = body

    const serverKey = Deno.env.get('MIDTRANS_SERVER_KEY')!
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

    // Verify Midtrans signature: SHA512(order_id + status_code + gross_amount + serverKey)
    const midtransEnv = (Deno.env.get('MIDTRANS_ENV') || 'sandbox').toLowerCase()
    const isSandboxTest = body.sandbox_test === true && midtransEnv === 'sandbox'

    if (!isSandboxTest) {
      const rawString = order_id + status_code + gross_amount + serverKey
      const hashBuffer = await crypto.subtle.digest('SHA-512', new TextEncoder().encode(rawString))
      const hashHex = Array.from(new Uint8Array(hashBuffer))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('')

      if (hashHex !== signature_key) {
        console.error('Invalid signature')
        return new Response('Invalid signature', { status: 403 })
      }
    }

    // Only process successful payments
    const isSuccess =
      transaction_status === 'settlement' ||
      (transaction_status === 'capture' && fraud_status === 'accept')

    if (!isSuccess) {
      return new Response('Not a success notification', { status: 200 })
    }

    const supabase = createClient(supabaseUrl, supabaseKey)

    // ── Voucher purchase (order_id starts with "vpc_") ──
    if (order_id.startsWith('vpc_')) {
      const { data: request } = await supabase
        .from('voucher_purchase_requests')
        .select('id, customer_id, product_id, qty')
        .eq('midtrans_order_id', order_id)
        .eq('status', 'pending')
        .single()

      if (request) {
        const { data: row } = await supabase
          .from('customer_product_vouchers')
          .select('balance')
          .eq('customer_id', request.customer_id)
          .eq('product_id', request.product_id)
          .single()

        await supabase
          .from('customer_product_vouchers')
          .upsert({
            customer_id: request.customer_id,
            product_id: request.product_id,
            balance: (row?.balance ?? 0) + request.qty,
          })

        await supabase
          .from('voucher_purchase_requests')
          .update({ status: 'confirmed' })
          .eq('id', request.id)
      }
    }

    // ── Order payment (order_id starts with "op_") ──
    if (order_id.startsWith('op_')) {
      await supabase
        .from('orders')
        .update({ payment_status: 'paid' })
        .eq('midtrans_order_id', order_id)
        .eq('payment_status', 'unpaid')
    }

    // ── Pre-pay order payment (order_id starts with "pop_") ──
    if (order_id.startsWith('pop_')) {
      await supabase
        .from('orders')
        .update({ payment_status: 'paid' })
        .eq('midtrans_order_id', order_id)
        .eq('payment_status', 'unpaid')
    }

    return new Response('OK', { status: 200 })
  } catch (error: any) {
    console.error('Webhook error:', error)
    return new Response('Error', { status: 500 })
  }
})
