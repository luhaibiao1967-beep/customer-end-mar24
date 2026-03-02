// Bottom navigation: Home | Order (Buy Vouchers) | Orders (Order Delivery) | My Account
import { useNavigate, useLocation } from 'react-router-dom';
import { useLanguage } from '../contexts/LanguageContext';
import { theme } from '../theme';

interface BottomNavProps {
  customer: { customer_type: string };
}

export default function BottomNav({ customer }: BottomNavProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useLanguage();

  const isActive = (path: string) => location.pathname === path;

  const navItems = [
    { path: '/customer-home', label: t('nav.home'), icon: '🏠' },
    { path: '/orders', label: t('nav.myOrders'), icon: null },
    { path: '/place-order', label: t('nav.newOrder'), icon: '🛒' },
    { path: '/account', label: t('nav.myAccount'), icon: 'img:myaccount' },
  ];

  return (
    <nav
      style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        background: theme.cardBg,
        borderTop: '1px solid #eee',
        display: 'flex',
        justifyContent: 'space-around',
        padding: '8px 0 12px',
        paddingBottom: 'max(12px, env(safe-area-inset-bottom))',
        zIndex: 1000,
        boxShadow: '0 -2px 10px rgba(0,0,0,0.08)',
      }}
    >
      {navItems.map((item) => {
        const active = isActive(item.path);
        return (
          <button
            key={item.path}
            onClick={() => navigate(item.path)}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '4px',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: '4px 12px',
              flex: 1,
              maxWidth: '80px',
            }}
          >
            {item.icon === null ? (
              <img
                src="/128-128gallon.png"
                alt="My Orders"
                style={{ width: '32px', height: '32px', opacity: active ? 1 : 0.7, objectFit: 'contain' }}
              />
            ) : item.icon === 'img:myaccount' ? (
              <img
                src="/myaccount.png"
                alt="My Account"
                style={{ width: '32px', height: '32px', opacity: active ? 1 : 0.7, objectFit: 'contain' }}
              />
            ) : (
              <span style={{ fontSize: '20px', opacity: active ? 1 : 0.7 }}>{item.icon}</span>
            )}
            <span
              style={{
                fontSize: '11px',
                fontWeight: active ? 600 : 400,
                color: active ? theme.primary : theme.textMuted,
                whiteSpace: 'nowrap',
              }}
            >
              {item.label}
            </span>
          </button>
        );
      })}
    </nav>
  );
}
