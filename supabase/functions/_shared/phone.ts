const INDONESIAN_MOBILE_NATIONAL_NUMBER = /^8\d{8,12}$/

/**
 * Normalize an Indonesian WhatsApp number to E.164.
 *
 * Accepted examples:
 *   0812...     -> +62812...
 *   812...      -> +62812...
 *   +62812...   -> +62812...
 *   +62 0812... -> +62812...
 */
export function normalizeIndonesianWhatsApp(phone: unknown): string | null {
  let digits = String(phone ?? '').replace(/\D/g, '')
  if (!digits) return null

  if (digits.startsWith('0062')) digits = digits.slice(2)

  let nationalNumber: string
  if (digits.startsWith('62')) {
    nationalNumber = digits.slice(2).replace(/^0+/, '')
  } else {
    nationalNumber = digits.replace(/^0+/, '')
  }

  if (!INDONESIAN_MOBILE_NATIONAL_NUMBER.test(nationalNumber)) return null
  return `+62${nationalNumber}`
}
