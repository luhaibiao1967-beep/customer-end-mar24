// V0-styled Top Navigation - inline styles
import { LogOut, User } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useLanguage } from '../contexts/LanguageContext';
import { useColorTokens } from '../contexts/ColorTokensContext';
import LanguageSwitcher from './LanguageSwitcher';
import { markLogoutForPwaPrompt } from '../utils/pwaInstall';

interface TopNavV0Props {
  customerName?: string;
  onSignOut?: () => void;
  loading?: boolean;
}

export default function TopNavV0({ customerName, onSignOut, loading }: TopNavV0Props) {
  const navigate = useNavigate();
  const { t } = useLanguage();
  const { tokens } = useColorTokens();

  const handleSignOut = () => {
    if (onSignOut) {
      onSignOut();
    } else {
      sessionStorage.clear();
      markLogoutForPwaPrompt();
      window.dispatchEvent(new Event('session-auth-updated'));
      navigate('/', { replace: true });
    }
  };

  return (
    <nav style={{
      position: 'fixed',
      top: 0,
      left: '50%',
      transform: 'translateX(-50%)',
      width: '100%',
      maxWidth: 430,
      background: tokens.navBg,
      backdropFilter: 'blur(20px)',
      WebkitBackdropFilter: 'blur(20px)',
      borderBottom: `1px solid ${tokens.navBorder}`,
      zIndex: 40,
    }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '10px 16px',
      }}>
        {/* Logo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <img
            src={`${import.meta.env.BASE_URL}logo.png`}
            alt="VividAqua"
            style={{ height: 24, objectFit: 'contain' }}
          />
        </div>

        {/* Right side */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <LanguageSwitcher />

          {customerName && (
            <button
              onClick={() => navigate('/account')}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '5px 10px', borderRadius: 8,
                background: tokens.primaryBg,
                border: `1px solid ${tokens.primaryBorder}`,
                color: tokens.primary, cursor: 'pointer', fontSize: 12, fontWeight: 500,
              }}
            >
              <User size={14} />
              <span>{customerName.split(' ')[0]}</span>
            </button>
          )}

          {onSignOut && (
            <button
              onClick={handleSignOut}
              disabled={loading}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '5px 10px', borderRadius: 8,
                background: 'rgba(239,68,68,0.1)',
                border: '1px solid rgba(239,68,68,0.2)',
                color: '#ef4444', cursor: 'pointer', fontSize: 12, fontWeight: 500,
                opacity: loading ? 0.5 : 1,
              }}
            >
              <LogOut size={14} />
              <span>{loading ? '...' : t('home.signOut')}</span>
            </button>
          )}
        </div>
      </div>
    </nav>
  );
}
