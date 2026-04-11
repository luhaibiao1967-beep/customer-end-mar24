import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

/** Matches My Account badge: orders still in progress */
const ACTIVE_ORDER_STATUSES = ['pending', 'processing', 'confirmed', 'on_delivery']

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const {
      token,
      order_id,
      active_order_count_only,
      limit,
      include_product_vouchers,
    } = await req.json()
    if (!token) throw new Error('Token is required')

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseKey)

    // Validate token
    const { data: customer, error: customerError } = await supabase
      .from('customers')
      .select('id, initial_borrowed_gallons, customer_type')
      .eq('auth_token', token)
      .single()

    if (customerError || !customer) throw new Error('Invalid or expired token')

    const isPrePay = customer.customer_type === 'pre_pay'

    // Lightweight path: badge count only (no order rows)
    if (active_order_count_only === true) {
      let countQuery = supabase
        .from('orders')
        .select('*', { count: 'exact', head: true })
        .eq('customer_id', customer.id)
        .in('status', ACTIVE_ORDER_STATUSES)
      if (isPrePay) {
        countQuery = countQuery.eq('payment_status', 'paid')
      }
      const { count, error: countError } = await countQuery
      if (countError) throw new Error('Failed to count orders: ' + countError.message)
      return new Response(
        JSON.stringify({ success: true, active_order_count: count ?? 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 },
      )
    }

    // Fetch single order or all orders
    if (order_id) {
      const { data: order, error: orderError } = await supabase
        .from('orders')
        .select('*, order_items(*)')
        .eq('id', order_id)
        .eq('customer_id', customer.id)
        .single()

      if (orderError) throw new Error('Failed to fetch order: ' + orderError.message)

      // pre_pay: unpaid orders are abandoned checkout (QRIS not completed) — not visible to customer
      if (isPrePay && order.payment_status === 'unpaid') {
        throw new Error('Order not found')
      }

      return new Response(
        JSON.stringify({ success: true, order }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 },
      )
    }

    // Fetch all orders (no order_items for list view - loaded on demand in detail view)
    // later_pay: may list unpaid (pay on delivery / later QRIS). pre_pay: only paid rows.
    let listQuery = supabase
      .from('orders')
      .select('id, customer_id, customer_name, customer_address, delivery_date, status, payment_status, total_amount, created_at, delivery_evidence, payment_evidence, borrowed_gallons')
      .eq('customer_id', customer.id)

    if (isPrePay) {
      listQuery = listQuery.eq('payment_status', 'paid')
    }

    listQuery = listQuery.order('created_at', { ascending: false })

    /** Hard cap: keep list payloads small for mobile */
    const ORDER_LIST_MAX = 80
    if (typeof limit === 'number' && limit > 0) {
      listQuery = listQuery.limit(Math.min(Math.floor(limit), ORDER_LIST_MAX))
    }

    const { data: orders, error: ordersError } = await listQuery

    if (ordersError) throw new Error('Failed to fetch orders: ' + ordersError.message)

    let product_vouchers: unknown[] | undefined
    if (include_product_vouchers === true && isPrePay) {
      const { data: pv, error: pvError } = await supabase
        .from('customer_product_vouchers')
        .select('product_id, balance, products(name)')
        .eq('customer_id', customer.id)
      if (pvError) {
        console.error('get-orders: product_vouchers', pvError.message)
      } else {
        product_vouchers = pv ?? []
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        orders: orders || [],
        initial_borrowed_gallons: customer.initial_borrowed_gallons || 0,
        ...(product_vouchers !== undefined ? { product_vouchers } : {}),
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 },
    )
  } catch (error: any) {
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 },
    )
  }
})
