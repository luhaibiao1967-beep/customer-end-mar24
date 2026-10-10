import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

async function read(relativePath) {
  return readFile(path.join(repoRoot, relativePath), 'utf8')
}

async function importTypeScript(relativePath) {
  const source = await read(relativePath)
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.ES2020,
    },
    fileName: relativePath,
  })
  const url = `data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`
  return import(url)
}

const backendPhone = await importTypeScript('supabase/functions/_shared/phone.ts')
const frontendSession = await importTypeScript('src/lib/customerSession.ts')
const otpPolicy = await importTypeScript('supabase/functions/_shared/otpPolicy.ts')

const equivalentInputs = [
  '081234567890',
  '81234567890',
  '+6281234567890',
  '+62 0812-3456-7890',
]

for (const input of equivalentInputs) {
  assert.equal(
    backendPhone.normalizeIndonesianWhatsApp(input),
    '+6281234567890',
    `backend normalization failed for ${input}`,
  )
  assert.equal(
    frontendSession.normalizeWhatsApp(input),
    '+6281234567890',
    `frontend normalization failed for ${input}`,
  )
}

for (const invalid of ['', '62', '+6208123', '1234567890', '+14155552671']) {
  assert.equal(backendPhone.normalizeIndonesianWhatsApp(invalid), null)
  assert.equal(frontendSession.normalizeWhatsApp(invalid), '')
}

assert.equal(otpPolicy.getOtpVerificationMode(false, null), 'reject')
assert.equal(otpPolicy.getOtpVerificationMode(false, ''), 'reject')
assert.equal(otpPolicy.getOtpVerificationMode(false, 'provider-request-id'), 'provider')
assert.equal(otpPolicy.getOtpVerificationMode(true, null), 'development_plaintext')
assert.equal(otpPolicy.getOtpVerificationMode(true, 'provider-request-id'), 'provider')

const sendSource = await read('supabase/functions/auth-send-otp/index.ts')
const verifySource = await read('supabase/functions/auth-verify-otp/index.ts')
const fazpassSource = await read('supabase/functions/_shared/fazpass.ts')
const registrationSource = await read('src/Pages/CustomerRegister.tsx')
const reauthSource = await read('src/Pages/CustomerReauth.tsx')
const magicLinkSource = await read('src/Components/MagicLinkHandler.tsx')
const appSource = await read('src/App.tsx')
const branchSelectionSource = await read('src/Pages/BranchSelection.tsx')
const deviceIdSource = await read('src/lib/deviceId.ts')
const logoutSources = await Promise.all([
  'src/Pages/CustomerHome.tsx',
  'src/Pages/MyAccount.tsx',
  'src/Components/TopNavV0.tsx',
].map(read))
const authFunctionSources = await Promise.all([
  'supabase/functions/auth-send-otp/index.ts',
  'supabase/functions/auth-verify-otp/index.ts',
  'supabase/functions/auth-check-device-login/index.ts',
  'supabase/functions/auth-check-and-send-link/index.ts',
].map(read))

assert.match(sendSource, /otp:\s*PROVIDER_OTP_SENTINEL/)
assert.doesNotMatch(sendSource, /otpFromFazpass|otp_code/)
assert.match(verifySource, /getOtpVerificationMode\(DEV_MODE,/)
assert.match(fazpassSource, /\/v1\/otp\/request/)
assert.match(fazpassSource, /\/v1\/otp\/verify/)
assert.match(fazpassSource, /JSON\.stringify\(\{ otp_id: otpId, otp \}\)/)

assert.doesNotMatch(registrationSource, /invoke\('auth-check-device-login'/)
assert.match(registrationSource, /writeCustomerSession\(data\.customer, data\.auth_token\)/)
assert.match(registrationSource, /navigate\(returnTo, \{ replace: true \}\)/)
assert.match(registrationSource, /data\.dev_mode && data\.otp/)
assert.match(
  appSource,
  /path="\/place-order"[\s\S]*?<BranchSelection customer=\{customer\} \/>[\s\S]*?<PlaceOrder customer=\{customer\} \/>/,
)
assert.doesNotMatch(appSource, /NoBranchRedirect/)
assert.doesNotMatch(branchSelectionSource, /const valid = \(data \|\| \[\]\)\.filter/)
assert.match(branchSelectionSource, /Keep those branches[\s\S]*selectable/)
assert.match(branchSelectionSource, /Number\.isFinite\(b\.distance\)/)

assert.match(reauthSource, /writeCustomerSession\(data\.customer, data\.auth_token\)/)
assert.match(reauthSource, /setRememberedLogin\(formattedPhone, rememberLogin\)/)
assert.match(reauthSource, /navigate\(returnTo, \{ replace: true \}\)/)
assert.match(reauthSource, /FunctionsHttpError/)
assert.match(reauthSource, /data\.dev_mode && data\.otp/)

assert.match(magicLinkSource, /writeCustomerSession\(data\.customer, authToken\)/)
assert.match(magicLinkSource, /setRememberedLogin\(data\.customer\.whatsapp/)
assert.match(deviceIdSource, /localStorage\.setItem\(STORAGE_KEY, fallbackId\)/)

for (const source of logoutSources) {
  assert.match(source, /clearCustomerSession\(\)/)
  assert.match(source, /clearRememberedLogin\(\)/)
}

for (const source of authFunctionSources) {
  assert.match(source, /normalizeIndonesianWhatsApp/)
  assert.doesNotMatch(source, /function formatPhoneNumber/)
}

console.log('Customer authentication regression checks passed.')
