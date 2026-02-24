#!/usr/bin/env node
/**
 * 测试 WhatsApp hello_world 模板
 * 用于判断是模板问题还是 Meta Development 模式限制
 *
 * 用法: 需先设置环境变量 WA_TOKEN（或替换下面的 token）
 * node scripts/test-hello-world.js [phone]
 */
const phone = process.argv[2] || '6281251617360';
const token = process.env.WA_TOKEN || 'YOUR_TOKEN_HERE'; // 从 Meta 获取或 Supabase Secrets

async function main() {
  if (token === 'YOUR_TOKEN_HERE') {
    console.error('请设置 WA_TOKEN 环境变量，或从 Supabase Secrets 复制 WA_CLOUD_API_TOKEN');
    process.exit(1);
  }
  const res = await fetch(`https://graph.facebook.com/v22.0/960149357187389/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: phone.replace(/\D/g, '').replace(/^0/, '62'),
      type: 'template',
      template: { name: 'hello_world', language: { code: 'en_US' } },
    }),
  });
  const data = await res.json();
  console.log(JSON.stringify(data, null, 2));
  if (data.messages?.[0]?.message_status === 'accepted') {
    console.log('\n✅ API 已接受，请检查 WhatsApp 是否收到 hello_world 消息');
    console.log('   若收不到 → 说明是 Development 模式限制，非模板问题');
  } else if (data.error) {
    console.log('\n❌ 发送失败:', data.error.message);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
