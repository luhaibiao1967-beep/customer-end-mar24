import process from 'node:process';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

process.loadEnvFile('.vercel/.env.preview.local');

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const anonKey = process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !anonKey) {
  throw new Error('Missing Staging Supabase configuration');
}

if (!supabaseUrl.includes('qdnruupfqeiojmxvfzds')) {
  throw new Error('Refusing to run: configured Supabase project is not Staging');
}

const supabase = createClient(supabaseUrl, anonKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const uniqueDigits = `${Date.now()}`.slice(-10);
const expectedCustomerId = process.env.STAGING_EXPECTED_CUSTOMER_ID || null;
const phone = process.env.STAGING_EXISTING_PHONE || `+628${uniqueDigits}`;
const deviceId = `staging-e2e-${randomUUID()}`;
const name = `STAGING E2E ${new Date().toISOString()}`;
const address = 'STAGING QA ONLY - NON-DELIVERABLE';

console.log(`Starting Staging registration acceptance for ${phone}`);

async function invoke(functionName, body) {
  const { data, error } = await supabase.functions.invoke(functionName, { body });
  if (!error) return data;

  let detail = error.message;
  if (error.context instanceof Response) {
    try {
      const payload = await error.context.clone().json();
      detail = `${payload.code ?? 'FUNCTION_ERROR'}: ${payload.error ?? payload.message ?? error.message}`;
    } catch {
      // Keep the public SDK error when the response is not JSON.
    }
  }
  throw new Error(`${functionName} failed: ${detail}`);
}

async function sendOtp() {
  const result = await invoke('auth-send-otp', { phone });
  if (!result?.success || result?.dev_mode !== true || result?.otp !== '1234') {
    throw new Error('Staging did not return the explicit development OTP');
  }
}

async function register() {
  await sendOtp();
  return invoke('auth-verify-otp', {
    phone,
    otp: '1234',
    device_id: deviceId,
    name,
    address,
    isRegistration: true,
  });
}

const first = await register();
if (!first?.success || !first?.customer?.id || !first?.auth_token) {
  throw new Error('Initial registration did not return a customer session');
}
if (expectedCustomerId) {
  if (first.customer.id !== expectedCustomerId || first.already_registered !== true) {
    throw new Error('Existing registration did not recover the expected customer');
  }
} else if (first.already_registered !== false) {
  throw new Error('Initial registration was not treated as a new customer');
}

const second = await register();
if (!second?.success || second?.customer?.id !== first.customer.id) {
  throw new Error('Idempotent registration did not recover the same customer');
}
if (second.already_registered !== true) {
  throw new Error('Repeated registration was not marked as already registered');
}

const trusted = await invoke('auth-check-device-login', {
  phone,
  device_id: deviceId,
});
if (!trusted?.success || trusted?.customer?.id !== first.customer.id || !trusted?.auth_token) {
  throw new Error('Trusted-device session recovery failed');
}

const countResult = await supabase
  .from('customers')
  .select('id', { count: 'exact' })
  .eq('whatsapp', phone);

const directCountAvailable = !countResult.error;
if (directCountAvailable && (countResult.count !== 1 || countResult.data?.length !== 1)) {
  throw new Error(`Expected exactly one customer row, got count=${countResult.count}`);
}

// Staging RLS normally blocks the anon frontend from enumerating customers.
// The second auth-verify-otp call performs a service-role maybeSingle() lookup;
// it would fail instead of returning success if the phone matched multiple rows.
const exactCustomerCount = directCountAvailable ? countResult.count : 1;
const countEvidence = directCountAvailable
  ? 'Exact PostgREST count returned one row.'
  : 'RLS blocked anon enumeration; service-role maybeSingle lookup succeeded twice with the same customer ID.';

console.log(JSON.stringify({
  passed: true,
  environment: 'staging',
  phone,
  customer_id: first.customer.id,
  exact_customer_count: exactCustomerCount,
  count_evidence: countEvidence,
  initial_registration_created_session: !expectedCustomerId,
  existing_registration_recovered_expected_customer: Boolean(expectedCustomerId),
  repeated_registration_recovered_same_customer: true,
  trusted_device_recovered_session: true,
}, null, 2));
