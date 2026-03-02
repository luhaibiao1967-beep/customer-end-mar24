// My Account - customer profile & settings
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import BottomNav from '../Components/BottomNav';
import { theme } from '../theme';
import toast from 'react-hot-toast';

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
  const [editingAddress, setEditingAddress] = useState(false);
  const [addressInput, setAddressInput] = useState(customer.address);
  const [savingAddress, setSavingAddress] = useState(false);
  const [productVouchers, setProductVouchers] = useState<{ product_id: string; balance: number; products: { name: string } | null }[]>([]);

  const handleSignOut = () => {
    sessionStorage.removeItem('customer');
    sessionStorage.removeItem('auth_token');
    sessionStorage.removeItem('authenticated');
    window.dispatchEvent(new Event('session-auth-updated'));
    navigate('/', { replace: true });
  };

  useEffect(() => {
    if (customer.customer_type === 'pre_pay') {
      supabase
        .from('customer_product_vouchers')
        .select('product_id, balance, products(name)')
        .eq('customer_id', customer.id)
        .then(({ data }) => setProductVouchers((data as any) || []));
    }
  }, [customer.id]);

  const handleSaveAddress = async () => {
    if (!addressInput.trim()) return;
    setSavingAddress(true);
    try {
      const { error } = await supabase
        .from('customers')
        .update({ address: addressInput.trim() })
        .eq('id', customer.id);
      if (error) throw error;
      toast.success('Address updated!');
      setEditingAddress(false);
      const stored = sessionStorage.getItem('customer');
      if (stored) {
        const parsed = JSON.parse(stored);
        sessionStorage.setItem('customer', JSON.stringify({ ...parsed, address: addressInput.trim() }));
      }
      window.dispatchEvent(new Event('session-auth-updated'));
    } catch (err: any) {
      toast.error('Failed to update address: ' + err.message);
    } finally {
      setSavingAddress(false);
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
              {editingAddress ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '4px' }}>
                  <input
                    value={addressInput}
                    onChange={e => setAddressInput(e.target.value)}
                    style={{ width: '100%', padding: '8px 10px', fontSize: '14px', border: `2px solid ${theme.primary}`, borderRadius: '8px', outline: 'none', boxSizing: 'border-box' }}
                    autoFocus
                  />
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button
                      onClick={handleSaveAddress}
                      disabled={savingAddress}
                      style={{ flex: 1, padding: '8px', background: theme.gradientPrimary, color: 'white', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: 'bold', cursor: savingAddress ? 'not-allowed' : 'pointer' }}
                    >
                      {savingAddress ? 'Saving...' : '✅ Save'}
                    </button>
                    <button
                      onClick={() => { setAddressInput(customer.address); setEditingAddress(false); }}
                      style={{ flex: 1, padding: '8px', background: 'none', color: theme.textMuted, border: '2px solid #ddd', borderRadius: '8px', fontSize: '13px', cursor: 'pointer' }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <p style={{ fontSize: '14px', color: theme.text, margin: 0, flex: 1 }}>
                    {addressInput}
                  </p>
                  <button
                    onClick={() => { setAddressInput(customer.address); setEditingAddress(true); }}
                    style={{ background: 'none', border: 'none', color: theme.primary, fontSize: '12px', cursor: 'pointer', padding: '4px 8px' }}
                  >
                    ✏️ Edit
                  </button>
                </div>
              )}
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
              <div style={{ background: theme.gradientPrimary, padding: '16px', borderRadius: '12px', color: 'white' }}>
                <p style={{ fontSize: '12px', margin: '0 0 10px 0', opacity: 0.9, fontWeight: '600' }}>
                  🎫 Voucher Balance
                </p>
                {productVouchers.length === 0 ? (
                  <p style={{ fontSize: '14px', margin: 0, opacity: 0.85 }}>No vouchers yet</p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {productVouchers.map(row => (
                      <div key={row.product_id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontSize: '13px', opacity: 0.9 }}>{row.products?.name ?? '—'}</span>
                        <span style={{ fontSize: '22px', fontWeight: 'bold' }}>{row.balance}</span>
                      </div>
                    ))}
                  </div>
                )}
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
              Sign Out
            </button>
          </div>
        </div>
      </div>
      <BottomNav customer={customer} />
    </div>
  );
}
