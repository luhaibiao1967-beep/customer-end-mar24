import { useCallback, useEffect, useState } from 'react'
import { theme } from '../theme'
import { useColorTokens } from '../contexts/ColorTokensContext'
import { useLanguage } from '../contexts/LanguageContext'
import {
  type BeforeInstallPromptEventLike,
  dismissPwaPromptForDays,
  isIosSafari,
  markPwaInstalledByUser,
  setPwaNeverPrompt,
} from '../utils/pwaInstall'

interface InstallAppModalProps {
  open: boolean
  onClose: () => void
}

export default function InstallAppModal({ open, onClose }: InstallAppModalProps) {
  const { t } = useLanguage()
  const { tokens, isDark } = useColorTokens()
  const [deferred, setDeferred] = useState<BeforeInstallPromptEventLike | null>(null)

  const handleClose = useCallback(() => {
    onClose()
  }, [onClose])

  useEffect(() => {
    if (!open) {
      setDeferred(null)
      return
    }
    const onBip = (e: Event) => {
      e.preventDefault()
      setDeferred(e as BeforeInstallPromptEventLike)
    }
    window.addEventListener('beforeinstallprompt', onBip)
    const onInstalled = () => {
      markPwaInstalledByUser()
      handleClose()
    }
    window.addEventListener('appinstalled', onInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', onBip)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [open, handleClose])

  if (!open) return null

  const ios = isIosSafari()
  const canNativeInstall = Boolean(deferred && !ios)

  const handleInstall = async () => {
    if (!deferred) return
    try {
      await deferred.prompt()
      const { outcome } = await deferred.userChoice
      setDeferred(null)
      if (outcome === 'accepted') markPwaInstalledByUser()
    } catch {
      /* ignore */
    }
    handleClose()
  }

  const handleLater = () => {
    dismissPwaPromptForDays(14)
    handleClose()
  }

  const handleNever = () => {
    setPwaNeverPrompt()
    handleClose()
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="pwa-install-title"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 5000,
        background: 'rgba(0,0,0,0.55)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 380,
          background: tokens.card,
          borderRadius: 20,
          padding: '24px 20px',
          boxShadow: '0 20px 60px rgba(0,0,0,0.35)',
          border: `1px solid ${tokens.primaryBorder}`,
        }}
      >
        <h2
          id="pwa-install-title"
          style={{ margin: '0 0 10px', fontSize: 18, fontWeight: 800, color: tokens.text }}
        >
          {t('pwaInstall.title')}
        </h2>
        <p style={{ margin: '0 0 16px', fontSize: 14, lineHeight: 1.55, color: tokens.muted }}>
          {t('pwaInstall.body')}
        </p>

        {ios && (
          <ol
            style={{
              margin: '0 0 18px',
              paddingLeft: 20,
              fontSize: 13,
              lineHeight: 1.6,
              color: tokens.text,
            }}
          >
            <li style={{ marginBottom: 8 }}>{t('pwaInstall.iosStep1')}</li>
            <li>{t('pwaInstall.iosStep2')}</li>
          </ol>
        )}

        {!ios && !canNativeInstall && (
          <p style={{ margin: '0 0 18px', fontSize: 13, lineHeight: 1.55, color: tokens.muted }}>
            {t('pwaInstall.androidManual')}
          </p>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {canNativeInstall && (
            <button
              type="button"
              onClick={handleInstall}
              style={{
                width: '100%',
                padding: '14px',
                borderRadius: 12,
                border: 'none',
                background: tokens.gradientPrimary ?? theme.gradientPrimary,
                color: 'white',
                fontSize: 15,
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              {t('pwaInstall.installNow')}
            </button>
          )}
          <button
            type="button"
            onClick={handleLater}
            style={{
              width: '100%',
              padding: '12px',
              borderRadius: 12,
              border: `2px solid ${tokens.primary}`,
              background: 'transparent',
              color: tokens.primary,
              fontSize: 14,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            {t('pwaInstall.later')}
          </button>
          <button
            type="button"
            onClick={handleNever}
            style={{
              width: '100%',
              padding: '10px',
              borderRadius: 12,
              border: 'none',
              background: 'transparent',
              color: isDark ? 'rgba(255,255,255,0.45)' : theme.textMuted,
              fontSize: 13,
              cursor: 'pointer',
            }}
          >
            {t('pwaInstall.never')}
          </button>
        </div>
      </div>
    </div>
  )
}
