/** Session flag: show install hint on login page after sign-out. */
export const PWA_PROMPT_AFTER_LOGOUT_KEY = 'show_pwa_prompt_after_logout'

const LS_NEVER = 'pwa_install_never'
const LS_DISMISS_UNTIL = 'pwa_install_dismissed_until'
const LS_INSTALLED = 'pwa_install_user_confirmed'

export function markLogoutForPwaPrompt(): void {
  try {
    sessionStorage.setItem(PWA_PROMPT_AFTER_LOGOUT_KEY, '1')
  } catch {
    /* ignore */
  }
}

/** Returns true if flag was set; clears the flag in all cases after read. */
export function consumeLogoutPwaPromptFlag(): boolean {
  try {
    const v = sessionStorage.getItem(PWA_PROMPT_AFTER_LOGOUT_KEY)
    sessionStorage.removeItem(PWA_PROMPT_AFTER_LOGOUT_KEY)
    return v === '1'
  } catch {
    return false
  }
}

export function isStandaloneDisplay(): boolean {
  if (typeof window === 'undefined') return false
  if (window.matchMedia('(display-mode: standalone)').matches) return true
  return (window.navigator as Navigator & { standalone?: boolean }).standalone === true
}

export function isIosSafari(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent
  const iOS =
    /iPad|iPhone|iPod/.test(ua) ||
    (navigator.platform === 'MacIntel' && (navigator as Navigator & { maxTouchPoints?: number }).maxTouchPoints! > 1)
  const webkit = /WebKit/.test(ua)
  const noChrome = !/CriOS|FxiOS|OPiOS|EdgiOS/.test(ua)
  return iOS && webkit && noChrome
}

export function shouldOfferPwaByDevice(): boolean {
  if (typeof window === 'undefined') return false
  if (window.matchMedia('(pointer: coarse)').matches) return true
  if (window.innerWidth < 900) return true
  return false
}

export function canShowPwaInstallPrompt(): boolean {
  if (typeof localStorage === 'undefined') return false
  if (isStandaloneDisplay()) return false
  if (!shouldOfferPwaByDevice()) return false
  try {
    if (localStorage.getItem(LS_NEVER) === '1') return false
    const until = localStorage.getItem(LS_DISMISS_UNTIL)
    if (until) {
      const ts = parseInt(until, 10)
      if (!Number.isNaN(ts) && Date.now() < ts) return false
    }
    if (localStorage.getItem(LS_INSTALLED) === '1') return false
  } catch {
    return false
  }
  return true
}

export function dismissPwaPromptForDays(days: number): void {
  try {
    const until = Date.now() + days * 24 * 60 * 60 * 1000
    localStorage.setItem(LS_DISMISS_UNTIL, String(until))
  } catch {
    /* ignore */
  }
}

export function setPwaNeverPrompt(): void {
  try {
    localStorage.setItem(LS_NEVER, '1')
  } catch {
    /* ignore */
  }
}

export function markPwaInstalledByUser(): void {
  try {
    localStorage.setItem(LS_INSTALLED, '1')
  } catch {
    /* ignore */
  }
}

export type BeforeInstallPromptEventLike = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}
