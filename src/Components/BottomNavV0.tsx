// V0-styled Bottom Navigation
import { useNavigate, useLocation } from 'react-router-dom';
import { Home, Droplets, Ticket, User } from 'lucide-react';
import { useColorTokens } from '../contexts/ColorTokensContext';

interface BottomNavV0Props {
  customer: { customer_type: string };
}

const navItems = [
  { path: '/customer-home', label: 'Home', icon: Home },
  { path: '/buy-vouchers', label: 'Voucher', icon: Ticket },
  { path: '/place-order', label: 'Order', icon: Droplets },
  { path: '/account', label: 'My Account', icon: User },
];

export default function BottomNavV0({ customer }: BottomNavV0Props) {
  const navigate = useNavigate();
  const location = useLocation();
  const isActive = (path: string) => location.pathname === path;
  const { tokens } = useColorTokens();

  return (
    <nav
      style={{
        position: 'fixed',
        bottom: 0,
        left: '50%',
        transform: 'translateX(-50%)',
        width: '100%',
        maxWidth: '430px',
        background: tokens.navBg,
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        borderTop: `1px solid ${tokens.navBorder}`,
        paddingBottom: 'env(safe-area-inset-bottom, 0px)',
        zIndex: 50,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-around',
          paddingTop: '8px',
          paddingBottom: '8px',
        }}
      >
        {navItems.map((item) => {
          const Icon = item.icon;
          const active = isActive(item.path);

          return (
            <button
              key={item.path}
              onClick={() => navigate(item.path)}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '4px',
                padding: '4px 8px',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                minWidth: '60px',
              }}
            >
              {/* Icon circle */}
              <div
                style={{
                  width: '40px',
                  height: '40px',
                  borderRadius: '50%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: active ? tokens.primaryBg : 'transparent',
                  transition: 'background 0.3s',
                }}
              >
                <Icon
                  size={20}
                  style={{
                    color: active ? tokens.primary : tokens.muted,
                    filter: active ? 'drop-shadow(0 0 6px rgba(77,204,204,0.5))' : 'none',
                    transition: 'color 0.3s, filter 0.3s',
                  }}
                />
              </div>

              {/* Label */}
              <span
                style={{
                  fontSize: '10px',
                  fontWeight: active ? 600 : 400,
                  color: active ? tokens.primary : tokens.muted,
                  whiteSpace: 'nowrap',
                  lineHeight: 1,
                  transition: 'color 0.3s',
                }}
              >
                {item.label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
