import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

// Set CUSTOMER_AUTH_PLAYWRIGHT_PATH to an installed playwright-core package.json
// when using a temporary npm-exec installation instead of a project dependency.
const require = createRequire(process.env.CUSTOMER_AUTH_PLAYWRIGHT_PATH || import.meta.url);
const { chromium } = require('playwright-core');
const baseUrl = new URL(process.env.CUSTOMER_AUTH_BASE_URL || 'http://127.0.0.1:5173');
if (!['127.0.0.1', 'localhost', '[::1]'].includes(baseUrl.hostname)) {
  throw new Error('These mocked authentication checks must run against a local development server.');
}

const customer = {
  id: '00000000-0000-4000-8000-000000000001',
  name: 'BROWSER TEST ONLY',
  address: 'MOCK ADDRESS - NOT FOR DELIVERY',
  whatsapp: '+6281234500000',
  customer_type: 'pre_pay',
  voucher_balance: 0,
  branch: 'MOCK TEST BRANCH',
  discount: 0,
};
const session = { customer, auth_token: 'mock-browser-test-session', success: true };
const browser = await chromium.launch({
  headless: true,
  ...(process.env.CUSTOMER_AUTH_BROWSER_EXECUTABLE ? { executablePath: process.env.CUSTOMER_AUTH_BROWSER_EXECUTABLE } : {}),
});
const results = [];

async function runCase(name, scenario, { authenticated = false, remember = false, trustedDevice = true, registrationBranch = customer.branch, mockMaps = false } = {}) {
  const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1000, height: 900 } });
  context.setDefaultTimeout(15_000);
  const requests = [];
  await context.addInitScript(({ fixture, authenticated, remember }) => {
    localStorage.setItem('app_language', 'en');
    localStorage.setItem('wd_device_id', 'mock-browser-device-id');
    // Only seed once so reload assertions cannot accidentally recreate a session.
    if (!localStorage.getItem('browser-auth-fixture-initialized')) {
      localStorage.setItem('browser-auth-fixture-initialized', 'true');
      localStorage.setItem('vividaqua:customer-remember-me', String(remember));
      if (remember) localStorage.setItem('vividaqua:customer-remembered-whatsapp', fixture.customer.whatsapp);
      if (authenticated) {
        sessionStorage.setItem('customer', JSON.stringify(fixture.customer));
        sessionStorage.setItem('auth_token', fixture.auth_token);
        sessionStorage.setItem('authenticated', 'true');
      }
    }
  }, { fixture: session, authenticated, remember });

  await context.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (mockMaps && url.origin === baseUrl.origin && url.pathname.endsWith('/@react-google-maps_api.js')) {
      // Stub only the external map dependency. The registration and branch
      // selection components, session writes and route guards remain real.
      return route.fulfill({ contentType: 'text/javascript', body: `
        import React from '/node_modules/.vite/deps/react.js';
        export const useJsApiLoader = () => ({ isLoaded: true });
        export const GoogleMap = ({ children }) => React.createElement('div', null, children);
        export const Marker = () => null;
        export const InfoWindow = ({ children }) => children;
        export function Autocomplete({ children, onLoad }) {
          React.useEffect(() => { onLoad?.({ getPlace: () => ({}) }); }, []);
          return React.createElement('div', null, children);
        }
      ` });
    }
    const localSupabaseProxy = url.origin === baseUrl.origin && /^\/supabase(?:\/|$)/.test(url.pathname);
    if (url.origin === baseUrl.origin && !localSupabaseProxy) return route.continue();

    // Intercept both cloud requests and the same-origin Vite /supabase proxy:
    // switching the development server to local Supabase must stay isolated.
    if (localSupabaseProxy || url.hostname.endsWith('.supabase.co')) {
      const headers = {
        'access-control-allow-origin': baseUrl.origin,
        'access-control-allow-headers': request.headers()['access-control-request-headers'] || '*',
        'access-control-allow-methods': 'GET, POST, PATCH, DELETE, OPTIONS',
        'content-type': 'application/json',
      };
      if (request.method() === 'OPTIONS') return route.fulfill({ status: 200, headers, body: '{}' });
      const functionName = url.pathname.split('/functions/v1/')[1];
      if (functionName) {
        const body = request.postDataJSON();
        requests.push({ functionName, body });
        let response = { success: true, products: [], vouchers: [], orders: [], active_order_count: 0 };
        if (functionName === 'auth-send-otp') response = { success: true, expires_in: 60 };
        if (functionName === 'auth-verify-otp') response = { ...session, customer: { ...customer, branch: registrationBranch } };
        if (functionName === 'auth-check-device-login') {
          response = trustedDevice
            ? { ...session, bound: true }
            : { success: true, bound: false, needs_otp: true };
        }
        return route.fulfill({ status: 200, headers, body: JSON.stringify(response) });
      }
      const rows = mockMaps && url.pathname.includes('/rest/v1/branches') ? [{
        id: 'mock-service-branch', name: customer.branch, address: 'MOCK BRANCH ADDRESS',
        phone: '+6281234500001', latitude: null, longitude: null, status: 'active',
        service_radius_km: 10, internal_demo: false,
      }] : [];
      return route.fulfill({ status: 200, headers, body: JSON.stringify(rows) });
    }
    return route.abort('blockedbyclient');
  });

  const page = await context.newPage();
  page.setDefaultTimeout(15_000);
  try {
    await scenario({ page, context, requests });
    results.push({ name, passed: true, mockedOtpRequests: requests.filter(r => r.functionName === 'auth-send-otp').length });
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}: ${error.message}`);
    throw error;
  } finally {
    await context.close();
  }
}

function pathOf(page) { return new URL(page.url()).pathname; }

try {
  await runCase('footer registration preserves the order target, phone, device, and remember opt-out', async ({ page, requests }) => {
    await page.goto(`${baseUrl.origin}/place-order`);
    await page.waitForURL(url => url.pathname === '/' && url.searchParams.get('returnTo') === '/place-order');
    await page.locator('input[type="tel"]').fill('081234500000');
    await page.locator('input[type="checkbox"]').uncheck();
    const link = page.locator('a[href^="/register?"]');
    const href = new URL(await link.getAttribute('href'), baseUrl);
    assert.equal(href.searchParams.get('returnTo'), '/place-order');
    assert.equal(href.searchParams.get('remember'), '0');
    assert.equal(href.searchParams.get('whatsapp'), customer.whatsapp);
    await link.click();
    await page.waitForURL(url => url.pathname === '/register');
    const registrationUrl = new URL(page.url());
    assert.equal(registrationUrl.searchParams.get('returnTo'), '/place-order');
    assert.equal(registrationUrl.searchParams.get('remember'), '0');
    assert.equal(registrationUrl.searchParams.get('device_id'), 'mock-browser-device-id');
    await page.getByPlaceholder('John Doe').waitFor();
    await page.waitForFunction(phone => document.querySelector('input[type="tel"]')?.value === phone, customer.whatsapp);
    assert.equal(await page.locator('input[type="tel"]').inputValue(), customer.whatsapp);
    assert.equal(requests.filter(r => r.functionName === 'auth-send-otp').length, 0);

    await page.getByPlaceholder('John Doe').fill(customer.name);
    await page.getByPlaceholder('Jl. Sudirman No. 123, South Jakarta').fill(customer.address);
    await page.locator('form button[type="submit"]').click();
    await page.getByPlaceholder('000000').fill('9876');
    await page.locator('form button[type="submit"]').click();
    await page.waitForURL(url => url.pathname === '/place-order');
    // Wait beyond the registration's delayed navigation to check the final route.
    await page.waitForTimeout(700);
    assert.equal(pathOf(page), '/place-order');
    assert.equal(requests.filter(r => r.functionName === 'auth-send-otp').length, 1);
    assert.equal(requests.filter(r => r.functionName === 'auth-verify-otp').length, 1);
    const verification = requests.find(r => r.functionName === 'auth-verify-otp').body;
    assert.equal(verification.isRegistration, true);
    assert.equal(verification.phone, customer.whatsapp);
    assert.equal(verification.device_id, 'mock-browser-device-id');
    const state = await page.evaluate(() => ({
      authenticated: sessionStorage.getItem('authenticated'),
      remembered: localStorage.getItem('vividaqua:customer-remembered-whatsapp'),
      preference: localStorage.getItem('vividaqua:customer-remember-me'),
    }));
    assert.deepEqual(state, { authenticated: 'true', remembered: null, preference: 'false' });
  });

  await runCase('new Pending registration selects a branch and stays on the order page', async ({ page, requests }) => {
    await page.goto(`${baseUrl.origin}/place-order`);
    await page.locator('a[href^="/register?"]').click();
    await page.getByPlaceholder('John Doe').fill(customer.name);
    await page.getByPlaceholder('Jl. Sudirman No. 123, South Jakarta').fill(customer.address);
    await page.locator('input[type="tel"]').fill(customer.whatsapp);
    await page.locator('form button[type="submit"]').click();
    await page.getByPlaceholder('000000').fill('9876');
    await page.locator('form button[type="submit"]').click();
    await page.waitForURL(url => url.pathname === '/place-order');
    await page.getByText(customer.branch, { exact: true }).click();
    await page.getByRole('button', { name: /Confirm.*MOCK TEST BRANCH/ }).click();
    await page.waitForFunction(() => JSON.parse(sessionStorage.getItem('customer')).branch === 'MOCK TEST BRANCH');
    await page.waitForTimeout(700);
    assert.equal(pathOf(page), '/place-order');
    assert.equal(requests.filter(r => r.functionName === 'update-customer-branch').length, 1);
    assert.equal(requests.filter(r => r.functionName === 'auth-verify-otp').length, 1);
    await page.getByRole('heading', { name: /New Delivery/ }).waitFor();
  }, { registrationBranch: 'Pending', mockMaps: true });

  for (const entry of ['/', '/login', '/register', '/reauth']) {
    await runCase(`authenticated ${entry} honors a safe order return target`, async ({ page }) => {
      await page.goto(`${baseUrl.origin}${entry}?returnTo=%2Fplace-order`);
      await page.waitForURL(url => url.pathname === '/place-order');
      assert.equal(pathOf(page), '/place-order');
    }, { authenticated: true });
  }

  await runCase('authenticated entry without a return target defaults to customer home', async ({ page }) => {
    await page.goto(`${baseUrl.origin}/register`);
    await page.waitForURL(url => url.pathname === '/customer-home');
  }, { authenticated: true });

  for (const unsafeTarget of ['https://example.invalid/', '//example.invalid/', '/not-a-customer-route']) {
    await runCase(`unsafe return target stays at customer home (${unsafeTarget})`, async ({ page }) => {
      await page.goto(`${baseUrl.origin}/login?returnTo=${encodeURIComponent(unsafeTarget)}`);
      await page.waitForURL(url => url.pathname === '/customer-home');
      assert.equal(new URL(page.url()).origin, baseUrl.origin);
    }, { authenticated: true });
  }

  await runCase('sign out clears the session and remembered number and does not restore login on reload', async ({ page, requests }) => {
    await page.goto(`${baseUrl.origin}/customer-home`);
    await page.getByRole('button', { name: 'Sign Out', exact: true }).first().click();
    await page.waitForURL(url => url.pathname === '/');
    const state = await page.evaluate(() => ({
      authenticated: sessionStorage.getItem('authenticated'),
      customer: sessionStorage.getItem('customer'),
      token: sessionStorage.getItem('auth_token'),
      remembered: localStorage.getItem('vividaqua:customer-remembered-whatsapp'),
      preference: localStorage.getItem('vividaqua:customer-remember-me'),
    }));
    assert.deepEqual(state, { authenticated: null, customer: null, token: null, remembered: null, preference: null });
    await page.reload();
    await page.locator('input[type="tel"]').waitFor();
    assert.equal(pathOf(page), '/');
    assert.equal(await page.locator('input[type="tel"]').inputValue(), '');
    assert.equal(requests.filter(r => r.functionName === 'auth-check-device-login').length, 0);
  }, { authenticated: true, remember: true });

  await runCase('remembered trusted device restores the session in a fresh tab', async ({ page, context, requests }) => {
    await page.goto(`${baseUrl.origin}/place-order`);
    await page.waitForURL(url => url.pathname === '/place-order');
    await page.evaluate(() => sessionStorage.clear());
    await page.close();
    const reopened = await context.newPage();
    await reopened.goto(`${baseUrl.origin}/place-order`);
    await reopened.waitForFunction(() => sessionStorage.getItem('authenticated') === 'true');
    await reopened.waitForURL(url => url.pathname === '/place-order');
    assert.equal(await reopened.evaluate(() => localStorage.getItem('vividaqua:customer-remembered-whatsapp')), customer.whatsapp);
    const restores = requests.filter(r => r.functionName === 'auth-check-device-login');
    // React StrictMode may repeat the read-only recovery effect in development.
    assert.ok(restores.length >= 1);
    for (const restore of restores) {
      assert.equal(restore.body.phone, customer.whatsapp);
      assert.equal(restore.body.device_id, 'mock-browser-device-id');
    }
    assert.equal(requests.filter(r => r.functionName === 'auth-send-otp').length, 0);
  }, { authenticated: true, remember: true });

  await runCase('remember opt-out stays signed out with an empty phone in a fresh tab', async ({ page, context, requests }) => {
    await page.goto(`${baseUrl.origin}/place-order`);
    await page.waitForURL(url => url.pathname === '/place-order');
    await page.evaluate(() => sessionStorage.clear());
    await page.close();
    const reopened = await context.newPage();
    await reopened.goto(`${baseUrl.origin}/place-order`);
    await reopened.waitForURL(url => url.pathname === '/' && url.searchParams.get('returnTo') === '/place-order');
    await reopened.locator('input[type="tel"]').waitFor();
    assert.equal(await reopened.locator('input[type="tel"]').inputValue(), '');
    assert.equal(await reopened.evaluate(() => sessionStorage.getItem('authenticated')), null);
    assert.equal(await reopened.evaluate(() => localStorage.getItem('vividaqua:customer-remembered-whatsapp')), null);
    assert.equal(requests.filter(r => r.functionName === 'auth-check-device-login').length, 0);
    assert.equal(requests.filter(r => r.functionName === 'auth-send-otp').length, 0);
  }, { authenticated: true, remember: false });

  await runCase('an unbound device requires one explicit OTP verification before entering the order page', async ({ page, requests }) => {
    await page.goto(`${baseUrl.origin}/place-order`);
    await page.locator('input[type="tel"]').fill(customer.whatsapp);
    await page.locator('form button[type="submit"]').click();
    await page.waitForURL(url => url.pathname === '/reauth');
    const reauthUrl = new URL(page.url());
    assert.equal(reauthUrl.searchParams.get('returnTo'), '/place-order');
    assert.equal(reauthUrl.searchParams.get('whatsapp'), customer.whatsapp);
    assert.equal(requests.filter(r => r.functionName === 'auth-send-otp').length, 0);
    assert.equal(await page.evaluate(() => sessionStorage.getItem('authenticated')), null);
    await page.waitForFunction(phone => document.querySelector('input[type="tel"]')?.value === phone, customer.whatsapp);
    await page.locator('form button[type="submit"]').click();
    await page.getByPlaceholder('0000', { exact: true }).fill('9876');
    await page.locator('form button[type="submit"]').click();
    await page.waitForURL(url => url.pathname === '/place-order');
    await page.waitForTimeout(700);
    assert.equal(pathOf(page), '/place-order');
    assert.equal(requests.filter(r => r.functionName === 'auth-send-otp').length, 1);
    const verifications = requests.filter(r => r.functionName === 'auth-verify-otp');
    assert.equal(verifications.length, 1);
    assert.equal(verifications[0].body.isRegistration, false);
    assert.equal(await page.evaluate(() => sessionStorage.getItem('authenticated')), 'true');
  }, { trustedDevice: false });

  console.log(JSON.stringify({ passed: true, cases: results.length, backend: 'fully mocked; no real OTP or backend mutation', results }, null, 2));
} finally {
  await browser.close();
}
