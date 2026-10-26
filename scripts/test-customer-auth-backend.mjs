import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import { webcrypto } from 'node:crypto'
import ts from 'typescript'

// Execute the real Edge handlers with an in-memory Supabase and Fazpass transport.
// These checks do not connect to Supabase, send messages, or use real credentials.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const phone = '+6281234500000'
const registration = {
  phone, otp: '9876', device_id: 'mock-device-for-registration',
  isRegistration: true, name: 'AUTH TEST', address: 'MOCK ADDRESS',
}

function database() {
  const rows = {
    auth_otps: [], customers: [], device_whatsapp_bindings: [], otp_send_log: [],
    app_settings: [], customer_product_vouchers: [], whatsapp_messages: [],
  }
  const stats = { customerInserts: 0, voucherGrants: 0 }
  let failBinding = false
  class Query {
    constructor(table) { this.table = table; this.action = 'select'; this.filters = []; this.maximum = Infinity }
    select() { return this }
    insert(value) { this.action = 'insert'; this.value = Array.isArray(value) ? value : [value]; return this }
    update(value) { this.action = 'update'; this.value = value; return this }
    upsert(value) { this.action = 'upsert'; this.value = value; return this }
    eq(key, value) { this.filters.push(row => row[key] === value); return this }
    gt(key, value) { this.filters.push(row => row[key] > value); return this }
    gte(key, value) { this.filters.push(row => row[key] >= value); return this }
    in(key, values) { this.filters.push(row => values.includes(row[key])); return this }
    order(key, options) { this.sort = { key, ascending: options.ascending }; return this }
    limit(value) { this.maximum = value; return this }
    maybeSingle() { return this.execute(true) }
    single() { return this.execute(true) }
    then(resolve, reject) { return this.execute(false).then(resolve, reject) }
    async execute(single) {
      let selected
      const tableRows = rows[this.table]
      if (this.action === 'insert') {
        const conflict = this.value.some(row => tableRows.some(existing =>
          (row.id && existing.id === row.id) ||
          (this.table === 'customers' && existing.whatsapp === row.whatsapp)))
        if (conflict) return { data: null, error: { code: '23505' } }
        selected = this.value.map(row => ({
          id: webcrypto.randomUUID(), created_at: new Date().toISOString(), ...row,
        }))
        tableRows.push(...selected)
        if (this.table === 'customers') stats.customerInserts += selected.length
      } else if (this.action === 'upsert') {
        if (this.table === 'device_whatsapp_bindings' && failBinding) {
          failBinding = false
          return { data: null, error: { code: 'MOCK_BINDING_FAILURE' } }
        }
        const keys = this.table === 'device_whatsapp_bindings'
          ? ['device_id', 'whatsapp'] : ['customer_id', 'product_id']
        const existing = tableRows.find(row => keys.every(key => row[key] === this.value[key]))
        if (existing) Object.assign(existing, this.value)
        else tableRows.push({ id: webcrypto.randomUUID(), ...this.value })
        selected = [this.value]
        if (this.table === 'customer_product_vouchers') stats.voucherGrants++
      } else {
        selected = tableRows.filter(row => this.filters.every(predicate => predicate(row)))
        if (this.sort) selected.sort((a, b) => {
          const difference = String(a[this.sort.key]).localeCompare(String(b[this.sort.key]))
          return this.sort.ascending ? difference : -difference
        })
        selected = selected.slice(0, this.maximum)
        if (this.action === 'update') selected.forEach(row => Object.assign(row, this.value))
      }
      return { data: single ? (selected[0] ? { ...selected[0] } : null) : selected.map(row => ({ ...row })), error: null }
    }
  }
  return {
    rows, stats, from: table => new Query(table),
    failNextBinding: () => { failBinding = true },
    seedOtp: (overrides = {}) => {
      const row = {
        id: webcrypto.randomUUID(), phone, otp: '__FAZPASS_PROVIDER__',
        request_id: webcrypto.randomUUID(), verified: false,
        created_at: new Date().toISOString(), expires_at: new Date(Date.now() + 300000).toISOString(),
        ...overrides,
      }
      rows.auth_otps.push(row)
      return row
    },
  }
}

async function handlers(db, { development = false, validOtp = true, missingProviderId = false } = {}) {
  const counters = { request: 0, verify: 0 }
  const cache = new Map()
  const captured = {}
  const environment = {
    ENVIRONMENT: development ? 'development' : 'production',
    SUPABASE_URL: 'https://mock.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'mock-only',
    FAZPASS_GATEWAY_KEY: 'mock-only', FAZPASS_MERCHANT_KEY: 'mock-only', APP_URL: 'https://mock.invalid',
  }
  async function preload(relativePath) {
    if (cache.has(relativePath)) return cache.get(relativePath)
    const source = await readFile(path.join(root, relativePath), 'utf8')
    const imports = [...source.matchAll(/from ['"]([^'"]+)['"]/g)].map(match => match[1])
    for (const specifier of imports) {
      if (specifier.startsWith('.') && !specifier.endsWith('/whatsappCloud.ts')) {
        await preload(path.posix.normalize(path.posix.join(path.posix.dirname(relativePath), specifier)))
      }
    }
    const module = { exports: {} }
    const sandbox = {
      module, exports: module.exports, Response, Request, Date, TextEncoder, AbortSignal,
      crypto: webcrypto, console: { log() {}, warn() {}, error() {} },
      Deno: { env: { get: key => environment[key] } },
      fetch: async (url, options) => {
        assert.ok(String(url).startsWith('https://api.fazpass.com/v1/otp/'), 'unexpected outbound request')
        const requestBody = JSON.parse(options.body)
        if (String(url).endsWith('/request')) {
          counters.request++
          assert.equal(requestBody.phone, phone.replace('+', ''))
          return Response.json({
            status: true, data: missingProviderId ? {} : { id: webcrypto.randomUUID(), otp: 'PRIVATE_PROVIDER_CODE' },
          })
        }
        counters.verify++
        assert.ok(requestBody.otp_id)
        return Response.json({ status: validOtp })
      },
      require: specifier => {
        if (specifier.startsWith('https://deno.land/')) return { serve: handler => { captured[relativePath] = handler } }
        if (specifier.startsWith('https://esm.sh/')) return { createClient: () => db }
        if (specifier.endsWith('/whatsappCloud.ts')) return {
          buildBodyParams: () => [], buildButtonUrlComponents: () => [],
          sendTemplateMessage: async () => ({ ok: true, data: {} }),
        }
        return cache.get(path.posix.normalize(path.posix.join(path.posix.dirname(relativePath), specifier)))
      },
    }
    const compiled = ts.transpileModule(source, {
      fileName: relativePath,
      compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
    }).outputText
    vm.runInNewContext(compiled, sandbox, { filename: relativePath })
    cache.set(relativePath, module.exports)
    return module.exports
  }
  const names = ['auth-send-otp', 'auth-verify-otp', 'auth-check-device-login']
  for (const name of names) await preload('supabase/functions/' + name + '/index.ts')
  const invoke = async (name, body, method = 'POST') => {
    const response = await captured['supabase/functions/' + name + '/index.ts'](
      new Request('https://mock.invalid/' + name, {
        method, headers: { 'content-type': 'application/json' },
        ...(method === 'POST' ? { body: JSON.stringify(body) } : {}),
      }),
    )
    return { status: response.status, body: await response.json() }
  }
  return { invoke, counters }
}

const cases = []
async function check(name, test) {
  await test()
  cases.push(name)
  console.log('PASS ' + name)
}

await check('registration creates one customer and returns a usable session; a new verified retry recovers it', async () => {
  const db = database()
  db.rows.app_settings.push({ key: 'welcome_voucher_qty', value: '2' }, { key: 'welcome_voucher_product_id', value: 'mock-product' })
  const { invoke } = await handlers(db)
  db.seedOtp()
  const first = await invoke('auth-verify-otp', registration)
  assert.equal(first.status, 200)
  assert.ok(first.body.auth_token)
  assert.equal(db.rows.customers.length, 1)
  db.seedOtp()
  const retry = await invoke('auth-verify-otp', { ...registration, name: 'DO NOT OVERWRITE EXISTING NAME' })
  assert.equal(retry.status, 200)
  assert.equal(retry.body.customer.id, first.body.customer.id)
  assert.equal(retry.body.auth_token, first.body.auth_token)
  assert.equal(retry.body.customer.name, registration.name)
  assert.equal(db.stats.customerInserts, 1)
  assert.equal(db.stats.voucherGrants, 1, 'registration retry must not grant welcome vouchers twice')
})

await check('concurrent verification consumes one OTP once and creates at most one customer', async () => {
  const db = database()
  db.seedOtp()
  const { invoke } = await handlers(db)
  const results = await Promise.all([
    invoke('auth-verify-otp', registration), invoke('auth-verify-otp', registration),
  ])
  assert.equal(results.filter(result => result.status === 200).length, 1)
  assert.equal(db.stats.customerInserts, 1)
  assert.equal(db.rows.device_whatsapp_bindings.length, 1)
  assert.ok(results.some(result => result.body.code === 'OTP_ALREADY_USED'))
})

await check('a registration whose device write failed recovers without duplicating the customer', async () => {
  const db = database()
  db.failNextBinding()
  db.seedOtp()
  const { invoke } = await handlers(db)
  assert.equal((await invoke('auth-verify-otp', registration)).status, 500)
  db.seedOtp()
  const retry = await invoke('auth-verify-otp', registration)
  assert.equal(retry.status, 200)
  assert.equal(db.stats.customerInserts, 1)
  assert.equal(db.rows.device_whatsapp_bindings.length, 1)
})

await check('production rejects plaintext OTP records and failed provider verification', async () => {
  const db = database()
  db.seedOtp({ request_id: null, otp: registration.otp })
  const { invoke } = await handlers(db)
  assert.equal((await invoke('auth-verify-otp', registration)).body.code, 'OTP_PROVIDER_SESSION_MISSING')
  assert.equal(db.rows.customers.length, 0)
  const rejected = database()
  rejected.seedOtp()
  const denied = await handlers(rejected, { validOtp: false })
  assert.equal((await denied.invoke('auth-verify-otp', registration)).body.code, 'INVALID_OR_EXPIRED_OTP')
  assert.equal(rejected.rows.customers.length, 0)
  assert.equal(rejected.rows.auth_otps[0].verified, false)
})

await check('concurrent sends for one phone use one provider request and do not persist provider OTP', async () => {
  const db = database()
  const { invoke, counters } = await handlers(db)
  const requests = await Promise.all([
    invoke('auth-send-otp', { phone, device_id: 'mock-send-device-1' }),
    invoke('auth-send-otp', { phone, device_id: 'mock-send-device-2' }),
  ])
  assert.equal(requests.filter(result => result.status === 200).length, 1)
  assert.equal(requests.filter(result => result.status === 429).length, 1)
  assert.equal(counters.request, 1)
  assert.equal(db.rows.auth_otps.length, 1)
  assert.equal(db.rows.auth_otps[0].otp, '__FAZPASS_PROVIDER__')
  assert.ok(!JSON.stringify(db.rows).includes('PRIVATE_PROVIDER_CODE'))
})

await check('a provider response without request id cannot enter the OTP step', async () => {
  const db = database()
  const { invoke } = await handlers(db, { missingProviderId: true })
  const response = await invoke('auth-send-otp', { phone, device_id: 'mock-send-device-1' })
  assert.equal(response.status, 502)
  assert.equal(response.body.code, 'OTP_PROVIDER_RESPONSE_INVALID')
  assert.equal(db.rows.auth_otps.length, 0)
})

await check('development test OTP is explicit and requires no provider request', async () => {
  const db = database()
  const { invoke, counters } = await handlers(db, { development: true })
  const response = await invoke('auth-send-otp', { phone, device_id: 'mock-send-device-1' })
  assert.equal(response.status, 200)
  assert.equal(response.body.dev_mode, true)
  assert.equal(response.body.otp, '1234')
  assert.equal(counters.request, 0)
})

await check('an existing customer needs OTP on a new device and restores only after verification', async () => {
  const db = database()
  db.rows.customers.push({ id: 'mock-existing-customer', whatsapp: phone, auth_token: 'mock-session-token' })
  const { invoke } = await handlers(db)
  assert.equal((await invoke('auth-check-device-login', registration)).body.needs_otp, true)
  db.seedOtp()
  const response = await invoke('auth-verify-otp', { ...registration, isRegistration: false })
  assert.equal(response.status, 200)
  const restored = await invoke('auth-check-device-login', registration)
  assert.equal(restored.body.bound, true)
  assert.equal(restored.body.auth_token, 'mock-session-token')
  assert.equal(db.stats.customerInserts, 0)
})

console.log(JSON.stringify({ passed: true, cases: cases.length, backend: 'in-memory only', checks: cases }, null, 2))
