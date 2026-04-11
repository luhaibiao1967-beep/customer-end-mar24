import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const VOUCHER_VALIDITY_MONTHS = 3
const EXPIRY_WARNING_DAYS = 30

function addMonthsUtc(iso: string, months: number): string {
  const dt = new Date(iso)
  if (Number.isNaN(dt.getTime())) return iso
  const y = dt.getUTCFullYear()
  const m = dt.getUTCMonth()
  const d = dt.getUTCDate()
  const hh = dt.getUTCHours()
  const mm = dt.getUTCMinutes()
  const ss = dt.getUTCSeconds()
  const ms = dt.getUTCMilliseconds()
  const out = new Date(Date.UTC(y, m + months, d, hh, mm, ss, ms))
  return out.toISOString()
}

function daysUntil(iso: string, now: Date): number | null {
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return null
  return Math.floor((t - now.getTime()) / (24 * 60 * 60 * 1000))
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { token } = await req.json()
    if (!token) throw new Error('Token is required')

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseKey)

    const { data: customer, error: customerError } = await supabase
      .from('customers')
      .select('id, customer_type')
      .eq('auth_token', token)
      .single()

    if (customerError || !customer) throw new Error('Invalid or expired token')

    if (customer.customer_type !== 'pre_pay') {
      return new Response(
        JSON.stringify({ success: true, purchases: [], usage: [] }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 },
      )
    }

    const { data: purchases, error: pErr } = await supabase
      .from('voucher_purchase_requests')
      .select('id, product_id, qty, amount_paid, status, created_at, products(name)')
      .eq('customer_id', customer.id)
      .order('created_at', { ascending: false })
      .limit(200)

    if (pErr) throw new Error('Failed to load purchases: ' + pErr.message)

    const { data: usageRows, error: uErr } = await supabase
      .from('voucher_usage_ledger')
      .select('id, order_id, product_id, voucher_qty, pricing_basis, created_at, products(name)')
      .eq('customer_id', customer.id)
      .order('created_at', { ascending: false })
      .limit(300)

    if (uErr) throw new Error('Failed to load usage: ' + uErr.message)

    const rawUsage = usageRows || []
    const orderIds = [...new Set(rawUsage.map((r: { order_id: string }) => r.order_id).filter(Boolean))]
    let orderDates: Record<string, string> = {}
    if (orderIds.length > 0) {
      const { data: ord } = await supabase
        .from('orders')
        .select('id, delivery_date')
        .eq('customer_id', customer.id)
        .in('id', orderIds)
      for (const o of ord || []) {
        orderDates[o.id] = o.delivery_date
      }
    }

    const usage = rawUsage.map((r: {
      id: string
      order_id: string
      product_id: string
      voucher_qty: number
      pricing_basis: string
      created_at: string
      products: { name: string } | null
    }) => ({
      id: r.id,
      order_id: r.order_id,
      product_id: r.product_id,
      product_name: r.products?.name ?? null,
      voucher_qty: r.voucher_qty,
      pricing_basis: r.pricing_basis,
      created_at: r.created_at,
      delivery_date: orderDates[r.order_id] ?? null,
    }))

    const now = new Date()
    const purchasesOut = (purchases || []).map((row: {
      id: string
      product_id: string
      qty: number
      amount_paid: number
      status: string
      created_at: string
      products: { name: string } | null
    }) => {
      const expiresAt = addMonthsUtc(row.created_at, VOUCHER_VALIDITY_MONTHS)
      const daysLeft = daysUntil(expiresAt, now)
      const effectiveStatus =
        row.status === 'confirmed' && daysLeft !== null && daysLeft < 0
          ? 'invalid'
          : row.status
      return {
        id: row.id,
        product_id: row.product_id,
        product_name: row.products?.name ?? null,
        qty: row.qty,
        amount_paid: row.amount_paid,
        status: effectiveStatus,
        created_at: row.created_at,
        expires_at: expiresAt,
        days_to_expiry: daysLeft,
        expiry_warning: daysLeft !== null && daysLeft >= 0 && daysLeft < EXPIRY_WARNING_DAYS,
      }
    })

    return new Response(
      JSON.stringify({ success: true, purchases: purchasesOut, usage }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 },
    )
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error)
    return new Response(
      JSON.stringify({ success: false, error: msg }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 },
    )
  }
})
