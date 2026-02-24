#!/usr/bin/env node
/**
 * 运行 Magic Link 诊断，查看最近发送记录和错误详情
 * 用法: node scripts/run-diagnostics.js
 */
const SUPABASE_URL = process.env.VITE_SUPABASE_URL_CLOUD || 'https://zpxdxyjzseuvdhxbuqpc.supabase.co';
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY_CLOUD || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpweGR4eWp6c2V1dmRoeGJ1cXBjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk4MDk5NzcsImV4cCI6MjA4NTM4NTk3N30.kXzhMg7q_CNsmG_6uF0EPB2asACyfgz-B_ocBHI3lQM';

async function main() {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/auth-magic-link-diagnostics`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` },
    body: '{}',
  });
  const d = await res.json();
  if (!d.success) {
    console.error('诊断失败:', d.error);
    process.exit(1);
  }
  console.log('\n📋 诊断结论:', d.summary?.diagnosis);
  console.log('\n环境:', JSON.stringify(d.env, null, 2));
  console.log('\n统计: 总', d.summary?.total_attempts, '| 成功', d.summary?.sent, '| 失败', d.summary?.failed);
  console.log('\n最近记录:');
  (d.recent_messages || []).forEach((m, i) => {
    console.log(`  ${i + 1}. ${m.phone} | ${m.status} | ${m.sent_at?.slice(0, 19)}`);
    if (m.error_detail) console.log('     ', m.error_detail);
  });
}

main().catch(e => { console.error(e); process.exit(1); });
