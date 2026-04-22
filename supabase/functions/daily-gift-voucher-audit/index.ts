import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
}

type VoucherRow = {
  customer_id: string
  product_id: string
  gift_balance: number
}

function parseRecipients(raw: string | undefined): string[] {
  if (!raw) return []
  return raw
    .split(/[,\n;]/g)
    .map((v) => v.trim())
    .filter((v) => v.length > 0)
}

function formatWibNow(): string {
  const d = new Date()
  return d.toLocaleString('sv-SE', { timeZone: 'Asia/Jakarta', hour12: false }).replace(' ', ' ')
}

function isEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)
}

async function sendAuditEmail(params: {
  to: string[]
  subject: string
  text: string
}): Promise<{ ok: boolean; status: number; body: unknown }> {
  const apiKey = Deno.env.get('RESEND_API_KEY')
  if (!apiKey) throw new Error('Missing RESEND_API_KEY')

  const from =
    Deno.env.get('GIFT_AUDIT_EMAIL_FROM') || 'VividAqua Audit <onboarding@resend.dev>'

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: params.to,
      subject: params.subject,
      text: params.text,
    }),
  })
  let body: unknown = null
  try {
    body = await res.json()
  } catch {
    body = await res.text()
  }
  return { ok: res.ok, status: res.status, body }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const cronSecret = Deno.env.get('GIFT_AUDIT_CRON_SECRET') || ''
    if (!cronSecret) throw new Error('Missing GIFT_AUDIT_CRON_SECRET')

    const incomingSecret = req.headers.get('x-cron-secret') || ''
    if (incomingSecret !== cronSecret) {
      return new Response(JSON.stringify({ success: false, error: 'Unauthorized' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 401,
      })
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseKey)

    const { data: settingsRows, error: settingsErr } = await supabase
      .from('app_settings')
      .select('key, value')
      .in('key', ['gift_voucher_audit_recipients', 'gift_voucher_audit_enabled'])
    if (settingsErr) throw new Error('Failed to read app settings: ' + settingsErr.message)
    const settings = new Map<string, string>((settingsRows || []).map((r) => [r.key, r.value]))

    const enabled = (settings.get('gift_voucher_audit_enabled') || '1') === '1'
    if (!enabled) {
      return new Response(JSON.stringify({ success: true, skipped: true, reason: 'disabled' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      })
    }

    const recipients = parseRecipients(settings.get('gift_voucher_audit_recipients'))
    if (!recipients.length) {
      throw new Error('No gift_voucher_audit_recipients configured (comma-separated emails in app_settings)')
    }
    for (const r of recipients) {
      if (!isEmail(r)) {
        throw new Error(
          `Invalid email in gift_voucher_audit_recipients: "${r}". Use comma-separated addresses only.`,
        )
      }
    }

    const { data: giftRows, error: giftErr } = await supabase
      .from('customer_product_vouchers')
      .select('customer_id, product_id, gift_balance')
      .gt('gift_balance', 0)
      .order('gift_balance', { ascending: false })
    if (giftErr) throw new Error('Failed to query gift vouchers: ' + giftErr.message)

    const rows = (giftRows || []) as VoucherRow[]
    const totalGift = rows.reduce((s, r) => s + (r.gift_balance || 0), 0)
    const customerIds = [...new Set(rows.map((r) => r.customer_id))]
    const productIds = [...new Set(rows.map((r) => r.product_id))]

    const { data: customerRows } = customerIds.length
      ? await supabase.from('customers').select('id, name').in('id', customerIds)
      : { data: [] as { id: string; name: string }[] }
    const { data: productRows } = productIds.length
      ? await supabase.from('products').select('id, name').in('id', productIds)
      : { data: [] as { id: string; name: string }[] }
    const customerMap = new Map<string, string>((customerRows || []).map((r) => [r.id, r.name || r.id]))
    const productMap = new Map<string, string>((productRows || []).map((r) => [r.id, r.name || r.id]))

    const topLines = rows
      .slice(0, 10)
      .map(
        (r) =>
          `${customerMap.get(r.customer_id) || r.customer_id} | ${productMap.get(r.product_id) || r.product_id} | ${r.gift_balance}`,
      )
      .join('\n') || '-'

    const checkedAtWib = formatWibNow()
    const subject = `[Gift voucher audit] ${checkedAtWib} WIB — total ${totalGift}, customers ${customerIds.length}`
    const text =
      `Gift voucher audit (Asia/Jakarta)\n` +
      `Checked at: ${checkedAtWib}\n` +
      `Total gift_balance (tickets): ${totalGift}\n` +
      `Customers with gift_balance > 0: ${customerIds.length}\n\n` +
      `Top rows:\n${topLines}\n`

    const emailResult = await sendAuditEmail({
      to: recipients,
      subject,
      text,
    })

    if (!emailResult.ok) {
      throw new Error(
        `Resend email failed: HTTP ${emailResult.status} — ${JSON.stringify(emailResult.body)}`,
      )
    }

    return new Response(
      JSON.stringify({
        success: true,
        channel: 'email',
        checked_at_wib: checkedAtWib,
        total_gift_vouchers: totalGift,
        customers_with_gift: customerIds.length,
        recipients,
        resend: emailResult.body,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 },
    )
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error('daily-gift-voucher-audit error:', msg)
    return new Response(JSON.stringify({ success: false, error: msg }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    })
  }
})
