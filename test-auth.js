#!/usr/bin/env node
/**
 * Magic Link 测试脚本
 * 调用 auth-check-and-send-link Edge Function，解析并打印 Magic Link
 *
 * 用法: node test-auth.js [phone]
 *       node test-auth.js          # 使用默认测试号码，自动创建测试客户
 *       node test-auth.js 6281234567890
 *
 * ENVIRONMENT=development 时，不真实发送 WhatsApp，直接返回 magic_link
 */

const SUPABASE_URL = process.env.VITE_SUPABASE_URL_CLOUD || 'https://zpxdxyjzseuvdhxbuqpc.supabase.co';
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY_CLOUD || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpweGR4eWp6c2V1dmRoeGJ1cXBjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk4MDk5NzcsImV4cCI6MjA4NTM4NTk3N30.kXzhMg7q_CNsmG_6uF0EPB2asACyfgz-B_ocBHI3lQM';

const DEFAULT_TEST_PHONE = '+6281700012345'; // 默认测试号码

function formatPhone(phone) {
  let cleaned = String(phone).replace(/\D/g, '');
  if (cleaned.startsWith('0')) cleaned = '62' + cleaned.substring(1);
  if (!cleaned.startsWith('62')) cleaned = '62' + cleaned;
  return '+' + cleaned;
}

async function ensureTestCustomer(supabase, phone) {
  const { data: existing } = await supabase.from('customers').select('id').eq('whatsapp', phone).single();
  if (existing) return;
  const { error } = await supabase.from('customers').insert({
    whatsapp: phone,
    name: 'Test Customer (Magic Link)',
    address: 'Test Address',
    voucher_balance: 0,
  });
  if (error) {
    console.error('创建测试客户失败:', error.message);
    process.exit(1);
  }
  console.log('✓ 已创建测试客户:', phone);
}

async function main() {
  const phoneArg = process.argv[2] || DEFAULT_TEST_PHONE.replace('+', '');
  const phone = formatPhone(phoneArg);

  // 若无传入号码且用默认号，先确保测试客户存在
  if (!process.argv[2]) {
    const { createClient } = await import('@supabase/supabase-js');
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    await ensureTestCustomer(supabase, phone);
  }
  const url = `${SUPABASE_URL}/functions/v1/auth-check-and-send-link`;

  console.log('📞 调用 auth-check-and-send-link...');
  console.log('   号码:', phone);

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify({ phone }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    const data = await res.json();

    if (!res.ok) {
      console.error('❌ 请求失败:', res.status, data);
      process.exit(1);
    }

    if (data.exists) {
      console.log('\n✅ 已注册客户');
      if (data.magic_link) {
        console.log('\n🔗 Magic Link:');
        console.log('   ', data.magic_link);
        console.log('\n📋 可直接复制上述链接在浏览器中打开登录。');
      }
      if (data.dev_mode) {
        console.log('\n🔧 DEV 模式: 未真实发送 WhatsApp');
      }
      if (data.message_sent === true) {
        console.log('\n📤 WhatsApp 已发送');
      } else if (data.message_sent === false) {
        console.log('\n⚠️ WhatsApp 发送失败，请运行 npm run diagnostics 查看详情');
      }
      if (data.wa_me_url) {
        console.log('   wa.me:', data.wa_me_url);
      }
    } else {
      console.log('\n⚠️ 未注册:', data.message || 'Customer not found');
      console.log('   请使用已注册的号码重试，或先完成注册。');
      process.exit(1);
    }
  } catch (err) {
    console.error('❌ 错误:', err.message);
    process.exit(1);
  }
}

main();
