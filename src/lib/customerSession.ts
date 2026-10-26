const REMEMBER_PREFERENCE_KEY = 'vividaqua:customer-remember-me'
const REMEMBERED_WHATSAPP_KEY = 'vividaqua:customer-remembered-whatsapp'

export interface CustomerSession {
  customer: unknown
  authToken: string
}

export function normalizeWhatsApp(phone: string): string {
  let digits = String(phone || '').replace(/\D/g, '')
  if (!digits) return ''
  if (digits.startsWith('0062')) digits = digits.slice(2)

  const nationalNumber = digits.startsWith('62')
    ? digits.slice(2).replace(/^0+/, '')
    : digits.replace(/^0+/, '')

  if (!/^8\d{8,12}$/.test(nationalNumber)) return ''
  return `+62${nationalNumber}`
}

export function getRememberPreference(): boolean {
  try {
    return localStorage.getItem(REMEMBER_PREFERENCE_KEY) !== 'false'
  } catch {
    return true
  }
}

export function getRememberedWhatsApp(): string | null {
  try {
    if (!getRememberPreference()) return null
    const phone = localStorage.getItem(REMEMBERED_WHATSAPP_KEY)
    return phone ? normalizeWhatsApp(phone) : null
  } catch {
    return null
  }
}

export function setRememberedLogin(phone: string, remember: boolean): void {
  try {
    localStorage.setItem(REMEMBER_PREFERENCE_KEY, remember ? 'true' : 'false')
    if (remember) {
      const normalized = normalizeWhatsApp(phone)
      if (normalized) localStorage.setItem(REMEMBERED_WHATSAPP_KEY, normalized)
    } else {
      localStorage.removeItem(REMEMBERED_WHATSAPP_KEY)
    }
  } catch {
    // Remember-me is best effort. The authenticated session remains usable.
  }
}

export function clearRememberedLogin(): void {
  try {
    localStorage.removeItem(REMEMBER_PREFERENCE_KEY)
    localStorage.removeItem(REMEMBERED_WHATSAPP_KEY)
  } catch {
    // Storage may be unavailable in private browsing modes.
  }
}

export function writeCustomerSession(customer: unknown, authToken: string): void {
  sessionStorage.setItem('customer', JSON.stringify(customer))
  sessionStorage.setItem('auth_token', authToken)
  sessionStorage.setItem('authenticated', 'true')
}

export function readCustomerSession(): CustomerSession | null {
  const authenticated = sessionStorage.getItem('authenticated')
  const customerJson = sessionStorage.getItem('customer')
  const authToken = sessionStorage.getItem('auth_token')
  if (authenticated !== 'true' || !customerJson || !authToken) return null

  try {
    return { customer: JSON.parse(customerJson), authToken }
  } catch {
    clearCustomerSession()
    return null
  }
}

export function clearCustomerSession(): void {
  sessionStorage.removeItem('customer')
  sessionStorage.removeItem('auth_token')
  sessionStorage.removeItem('authenticated')
}

export function getSafeCustomerReturnTo(
  value: string | null | undefined,
  fallback = '/customer-home',
): string {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return fallback
  const allowedPaths = new Set([
    '/customer-home',
    '/place-order',
    '/buy-vouchers',
    '/orders',
    '/account',
    '/select-branch',
  ])
  const pathname = value.split(/[?#]/, 1)[0]
  return allowedPaths.has(pathname) ? value : fallback
}
