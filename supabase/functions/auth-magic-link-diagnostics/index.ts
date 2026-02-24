import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseKey)

    // 1. Environment config (no secrets exposed)
    const env = {
      ENVIRONMENT: Deno.env.get('ENVIRONMENT') || '(not set)',
      dev_mode: Deno.env.get('ENVIRONMENT') === 'development',
      WA_TEMPLATE_MAGIC_LINK: Deno.env.get('WA_TEMPLATE_MAGIC_LINK') ? '✓ set' : '✗ not set',
      WA_TEMPLATE_MAGIC_LINK_SIMPLE: Deno.env.get('WA_TEMPLATE_MAGIC_LINK_SIMPLE') ? '✓ set' : '(not set)',
      WA_CLOUD_API_TOKEN: Deno.env.get('WA_CLOUD_API_TOKEN') ? '✓ set' : '✗ not set',
      WA_CLOUD_PHONE_NUMBER_ID: Deno.env.get('WA_CLOUD_PHONE_NUMBER_ID') ? '✓ set' : '✗ not set',
      APP_URL: Deno.env.get('APP_URL') || '(not set)',
      WA_BUSINESS_WHATSAPP_NUMBER: Deno.env.get('WA_BUSINESS_WHATSAPP_NUMBER') ? '✓ set' : '(not set)',
    }

    // 2. Recent login_link send attempts from whatsapp_messages
    const { data: messages, error: msgError } = await supabase
      .from('whatsapp_messages')
      .select('id, phone, status, provider_response, sent_at, message_type')
      .eq('message_type', 'login_link')
      .order('sent_at', { ascending: false })
      .limit(20)

    if (msgError) {
      console.error('whatsapp_messages query error:', msgError)
    }

    // 3. Summary stats
    const recent = messages || []
    const sentCount = recent.filter((m) => m.status === 'sent').length
    const failedCount = recent.filter((m) => m.status === 'failed').length
    const totalCount = recent.length

    // 4. Parse provider_response for failed ones to extract error
    const parsedMessages = recent.map((m) => {
      let errorDetail = ''
      if (m.status === 'failed' && m.provider_response) {
        try {
          const pr = typeof m.provider_response === 'string' ? JSON.parse(m.provider_response) : m.provider_response
          errorDetail = pr?.error?.message || pr?.error?.error_user_msg || pr?.error?.error_user_title || JSON.stringify(pr?.error || pr).slice(0, 200)
        } catch (_) {
          errorDetail = String(m.provider_response).slice(0, 200)
        }
      } else if (m.status === 'sent' && m.provider_response) {
        try {
          const pr = typeof m.provider_response === 'string' ? JSON.parse(m.provider_response) : m.provider_response
          errorDetail = pr?.messages?.[0]?.id ? `message_id: ${pr.messages[0].id}` : ''
        } catch (_) {}
      }
      return {
        id: m.id,
        phone: m.phone ? `${String(m.phone).slice(0, 8)}***` : '(unknown)',
        status: m.status,
        sent_at: m.sent_at,
        error_detail: errorDetail,
      }
    })

    const result = {
      success: true,
      env,
      summary: {
        total_attempts: totalCount,
        sent: sentCount,
        failed: failedCount,
        diagnosis: env.dev_mode
          ? '⚠️ ENVIRONMENT=development → WhatsApp 不会真正发送'
          : !env.WA_CLOUD_API_TOKEN.includes('✓') || !env.WA_CLOUD_PHONE_NUMBER_ID.includes('✓')
            ? '⚠️ 缺少 WA_CLOUD_API_TOKEN 或 WA_CLOUD_PHONE_NUMBER_ID'
            : !env.WA_TEMPLATE_MAGIC_LINK.includes('✓') && !env.WA_TEMPLATE_MAGIC_LINK_SIMPLE.includes('✓')
              ? '⚠️ 缺少 WA_TEMPLATE_MAGIC_LINK 或 WA_TEMPLATE_MAGIC_LINK_SIMPLE'
              : failedCount > 0
                ? '❌ 有发送失败记录，请查看下方详情'
                : sentCount > 0
                  ? '✅ API 已接受发送，若用户收不到请检查：测试号码白名单、消息请求、Live 模式'
                  : 'ℹ️ 暂无 login_link 发送记录',
      },
      recent_messages: parsedMessages,
    }

    return new Response(JSON.stringify(result, null, 2), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    })
  } catch (err: any) {
    console.error('Diagnostics error:', err)
    return new Response(
      JSON.stringify({
        success: false,
        error: err.message,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      }
    )
  }
})
