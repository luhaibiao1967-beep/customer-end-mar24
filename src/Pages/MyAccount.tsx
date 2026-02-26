// My Account - customer profile & settings
import { useNavigate } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import BottomNav from '../Components/BottomNav';
import { theme } from '../theme';

interface Customer {
  id: string;
  name: string;
  address: string;
  whatsapp: string;
  customer_type: string;
  voucher_balance: number;
  branch: string;
  discount: number;
}

interface MyAccountProps {
  customer: Customer;
}

export default function MyAccount({ customer }: MyAccountProps) {
  const navigate = useNavigate();

  const handleSignOut = () => {
    sessionStorage.removeItem('customer');
    sessionStorage.removeItem('auth_token');
    sessionStorage.removeItem('authenticated');
    window.dispatchEvent(new Event('session-auth-updated'));
    navigate('/', { replace: true });
  };

  const handleEditAddress = () => {
    const newAddress = prompt('Enter new address:', customer.address);
    if (newAddress) {
      supabase
        .from('customers')
        .update({ address: newAddress })
        .eq('id', customer.id)
        .then(() => {
          alert('Address updated!');
          window.location.reload();
        });
    }
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        background: theme.gradientPrimary,
        padding: '20px',
        paddingBottom: '80px',
      }}
    >
      <div style={{ maxWidth: '800px', margin: '0 auto' }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '24px',
          }}
        >
          <h1 style={{ color: 'white', fontSize: '24px', margin: 0, fontWeight: 'bold' }}>
            My Account
          </h1>
        </div>

        <div
          style={{
            background: theme.cardBg,
            borderRadius: '20px',
            padding: '24px',
            boxShadow: '0 10px 40px rgba(0,0,0,0.2)',
          }}
        >
          <div style={{ textAlign: 'center', marginBottom: '24px' }}>
            <div
              style={{
                width: '80px',
                height: '80px',
                background: theme.gradientPrimary,
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto 16px',
                fontSize: '36px',
              }}
            >
              👤
            </div>
            <h2 style={{ fontSize: '22px', margin: '0 0 8px 0', fontWeight: '600' }}>
              {customer.name}
            </h2>
            <p style={{ color: theme.textMuted, margin: 0, fontSize: '14px' }}>
              {customer.customer_type === 'pre_pay' ? 'Prepaid' : 'Postpaid'}
            </p>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div
              style={{
                background: theme.cardBgAlt,
                padding: '16px',
                borderRadius: '12px',
              }}
            >
              <p style={{ fontSize: '11px', color: theme.textLight, margin: '0 0 6px 0' }}>
                📍 Delivery Address
              </p>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <p style={{ fontSize: '14px', color: theme.text, margin: 0, flex: 1 }}>
                  {customer.address}
                </p>
                <button
                  onClick={handleEditAddress}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: theme.primary,
                    fontSize: '12px',
                    cursor: 'pointer',
                    padding: '4px 8px',
                  }}
                >
                  ✏️ Edit
                </button>
              </div>
            </div>

            <div
              style={{
                background: theme.cardBgAlt,
                padding: '16px',
                borderRadius: '12px',
              }}
            >
              <p style={{ fontSize: '11px', color: theme.textLight, margin: '0 0 6px 0' }}>
                💬 WhatsApp
              </p>
              <p style={{ fontSize: '14px', color: theme.text, margin: 0 }}>
                {customer.whatsapp}
              </p>
            </div>

            <div
              style={{
                background: theme.cardBgAlt,
                padding: '16px',
                borderRadius: '12px',
              }}
            >
              <p style={{ fontSize: '11px', color: theme.textLight, margin: '0 0 6px 0' }}>
                🏢 Service Branch
              </p>
              <p style={{ fontSize: '14px', color: theme.text, margin: 0 }}>
                {customer.branch === 'Pending' ? 'Pending Setup' : customer.branch || 'Not assigned'}
              </p>
            </div>

            {customer.customer_type === 'pre_pay' && (
              <div
                style={{
                  background: theme.gradientPrimary,
                  padding: '16px',
                  borderRadius: '12px',
                  color: 'white',
                  textAlign: 'center',
                }}
              >
                <p style={{ fontSize: '12px', margin: '0 0 4px 0', opacity: 0.9 }}>
                  Voucher Balance
                </p>
                <p style={{ fontSize: '28px', fontWeight: 'bold', margin: 0 }}>
                  {customer.voucher_balance}
                </p>
                <p style={{ fontSize: '12px', margin: '4px 0 0 0', opacity: 0.9 }}>
                  vouchers available
                </p>
              </div>
            )}
          </div>

          <div style={{ marginTop: '24px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <button
              onClick={() => navigate('/orders')}
              style={{
                padding: '14px',
                background: theme.cardBgAlt,
                color: theme.text,
                border: 'none',
                borderRadius: '12px',
                fontSize: '16px',
                fontWeight: '500',
                cursor: 'pointer',
                textAlign: 'left',
              }}
            >
              📋 Order History
            </button>

            <button
              onClick={handleSignOut}
              style={{
                padding: '14px',
                background: 'transparent',
                color: theme.error,
                border: `2px solid ${theme.error}`,
                borderRadius: '12px',
                fontSize: '16px',
                fontWeight: '600',
                cursor: 'pointer',
              }}
            >
              🚪 Sign Out
            </button>
          </div>
        </div>
      </div>
      <BottomNav customer={customer} />
    </div>
  );
}
