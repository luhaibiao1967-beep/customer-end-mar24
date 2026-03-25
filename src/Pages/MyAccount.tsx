// My Account - v0 style, inline styles (Tailwind not reliably generated)
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import BottomNavV0 from '../Components/BottomNavV0';
import TopNavV0 from '../Components/TopNavV0';
import toast from 'react-hot-toast';
import { useLanguage } from '../contexts/LanguageContext';
import { useColorTokens } from '../contexts/ColorTokensContext';
import { theme } from '../theme';
import {
  User,
  MapPin,
  MessageCircle,
  Building2,
  Ticket,
  ClipboardList,
  Droplets,
  LogOut,
  ChevronRight,
  Pencil,
  Check,
  X,
  Moon,
  Sun,
} from 'lucide-react';

interface Customer {
  id: string;
  name: string;
  address: string;
  whatsapp: string;
  customer_type: string;
  voucher_balance: number;
  branch: string;
  discount: number;
  credit_limit?: number | null;
  payment_term?: string;
}

interface MyAccountProps {
  customer: Customer;
}

const ACTIVE_STATUSES = ['pending', 'processing', 'confirmed', 'on_delivery'];


export default function MyAccount({ customer }: MyAccountProps) {
  const navigate = useNavigate();
  const { t } = useLanguage();
  const { tokens: COLOR, isDark, toggleTheme } = useColorTokens();

  const iconBox: React.CSSProperties = {
    width: 36, height: 36, borderRadius: 10,
    background: COLOR.primaryBg,
    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  };
  const menuRow: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 12,
    padding: '14px 16px', background: 'none', border: 'none',
    width: '100%', cursor: 'pointer', textAlign: 'left' as const,
  };
  const card: React.CSSProperties = {
    background: COLOR.card,
    border: `1px solid ${COLOR.cardBorder}`,
    borderRadius: 16, overflow: 'hidden',
    backdropFilter: COLOR.cardBlur,
    WebkitBackdropFilter: COLOR.cardBlur,
  };
  const sectionLabel: React.CSSProperties = {
    fontSize: 11, color: COLOR.muted,
    textTransform: 'uppercase' as const, letterSpacing: '0.08em',
    marginBottom: 8, paddingLeft: 4,
  };

  const [editingAddress, setEditingAddress] = useState(false);
  const [addressInput, setAddressInput] = useState(customer.address);
  const [savingAddress, setSavingAddress] = useState(false);
  const [productVouchers, setProductVouchers] = useState<
    { product_id: string; balance: number; products: { name: string } | null }[]
  >([]);
  const [activeOrderCount, setActiveOrderCount] = useState<number | null>(null);

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

    const token = sessionStorage.getItem('auth_token');
    if (token) {
      supabase.functions
        .invoke('get-orders', { body: { token } })
        .then(({ data }) => {
          if (data?.success && Array.isArray(data.orders)) {
            const active = data.orders.filter((o: any) =>
              ACTIVE_STATUSES.includes(o.status)
            );
            setActiveOrderCount(active.length);
          }
        });
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
      toast.success(t('account.addressUpdated'));
      setEditingAddress(false);
      const stored = sessionStorage.getItem('customer');
      if (stored) {
        const parsed = JSON.parse(stored);
        sessionStorage.setItem('customer', JSON.stringify({ ...parsed, address: addressInput.trim() }));
      }
      window.dispatchEvent(new Event('session-auth-updated'));
    } catch (err: any) {
      toast.error(t('account.updateFailed') + err.message);
    } finally {
      setSavingAddress(false);
    }
  };

  const totalVouchers = productVouchers.reduce((sum, v) => sum + v.balance, 0);

  return (
    <div style={{ minHeight: '100vh', background: COLOR.pageBg }}>
      <TopNavV0 customerName={customer.name} />

      <div style={{ maxWidth: 430, margin: '0 auto', paddingTop: 60, paddingBottom: 88 }}>

        {/* ── Header ── */}
        <div style={{ position: 'relative', overflow: 'hidden' }}>
          {/* Glow blobs */}
          {isDark && (
            <>
              <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 160,
                background: 'linear-gradient(135deg, rgba(0,180,216,0.15) 0%, transparent 60%)',
                pointerEvents: 'none' }} />
              <div style={{ position: 'absolute', top: 20, left: 20, width: 120, height: 120,
                borderRadius: '50%', background: 'rgba(0,180,216,0.08)',
                filter: 'blur(40px)', pointerEvents: 'none' }} />
              <div style={{ position: 'absolute', top: 40, right: 20, width: 100, height: 100,
                borderRadius: '50%', background: 'rgba(0,206,209,0.06)',
                filter: 'blur(40px)', pointerEvents: 'none' }} />
            </>
          )}

          {/* Log Out — top right */}
          <button
            onClick={handleSignOut}
            title="Log Out"
            style={{
              position: 'absolute', top: 16, right: 16, zIndex: 10,
              width: 36, height: 36, borderRadius: '50%',
              background: isDark ? 'rgba(30,40,55,0.7)' : 'rgba(255,255,255,0.7)',
              border: `1px solid ${COLOR.cardBorder}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer',
            }}
          >
            <LogOut size={16} color={COLOR.muted} />
          </button>

          {/* User info */}
          <div style={{ padding: '16px 16px 20px', position: 'relative' }}>
            <div style={{
              ...card,
              padding: '20px 16px',
              display: 'flex', alignItems: 'center', gap: 16,
            }}>
              {/* Avatar */}
              <div style={{
                width: 72, height: 72, borderRadius: '50%',
                background: 'linear-gradient(135deg, #00A0E9 0%, #00B4D8 50%, #00CED1 100%)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0,
                boxShadow: `0 0 0 3px ${COLOR.primaryBorder}, 0 4px 16px rgba(0,160,233,0.25)`,
              }}>
                <User size={32} color="white" />
              </div>

              {/* Name / Phone / Badge */}
              <div style={{ flex: 1, minWidth: 0, paddingRight: 36 }}>
                <p style={{ color: COLOR.text, fontWeight: 800, fontSize: 20, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {customer.name}
                </p>
                <p style={{ color: COLOR.text, fontSize: 14, fontWeight: 500, margin: '5px 0 10px', opacity: 0.7 }}>
                  {customer.whatsapp}
                </p>
                <span style={{
                  display: 'inline-block',
                  padding: '4px 14px', borderRadius: 20,
                  background: COLOR.gradientPrimary,
                  color: 'white', fontSize: 11, fontWeight: 700,
                  letterSpacing: '0.03em',
                }}>
                  {customer.customer_type === 'pre_pay' ? t('account.prepaid') : t('account.postpaid')}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* ── Voucher Stats (pre_pay only) ── */}
        {customer.customer_type === 'pre_pay' && productVouchers.length > 0 && (
          <div style={{ padding: '0 16px 16px' }}>
            <div style={{ ...card, padding: 12 }}>
              <div style={{
                display: 'grid',
                gridTemplateColumns: `repeat(${Math.min(productVouchers.length, 4)}, 1fr)`,
                gap: 8, textAlign: 'center',
              }}>
                {productVouchers.map(row => (
                  <div key={row.product_id}>
                    <p style={{
                      fontSize: 26, fontWeight: 700, margin: 0,
                      background: 'linear-gradient(135deg, #00A0E9, #00CED1)',
                      WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
                    }}>
                      {row.balance}
                    </p>
                    <p style={{ fontSize: 11, color: COLOR.muted, margin: '4px 0 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {row.products?.name ?? '—'}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ── Menu Groups ── */}
        <div style={{ padding: '0 16px', display: 'flex', flexDirection: 'column', gap: 6 }}>

          {/* Orders */}
          <div>
            <div style={card}>
              <p style={{ margin: 0, padding: '12px 16px 0', fontSize: 11, color: COLOR.primary, fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '0.08em' }}>Orders</p>
              {/* My Orders */}
              <button
                onClick={() => navigate('/orders')}
                style={{ ...menuRow, borderBottom: `1px solid ${COLOR.divider}` }}
              >
                <div style={iconBox}><Droplets size={18} color={COLOR.primary} /></div>
                <span style={{ flex: 1, color: COLOR.text, fontWeight: 500, fontSize: 15 }}>My Orders</span>
                {activeOrderCount !== null && activeOrderCount > 0 && (
                  <span style={{
                    padding: '2px 8px', borderRadius: 20,
                    background: COLOR.primaryBg, color: COLOR.primary,
                    fontSize: 12, fontWeight: 600,
                  }}>{activeOrderCount}</span>
                )}
                <ChevronRight size={18} color={COLOR.muted} />
              </button>

              {/* My Vouchers (pre_pay) */}
              {customer.customer_type === 'pre_pay' && (
                <button
                  onClick={() => navigate('/buy-vouchers')}
                  style={{ ...menuRow, borderBottom: `1px solid ${COLOR.divider}` }}
                >
                  <div style={iconBox}><Ticket size={18} color={COLOR.primary} /></div>
                  <span style={{ flex: 1, color: COLOR.text, fontWeight: 500, fontSize: 15 }}>My Vouchers</span>
                  {totalVouchers > 0 && (
                    <span style={{
                      padding: '2px 8px', borderRadius: 20,
                      background: COLOR.primaryBg, color: COLOR.primary,
                      fontSize: 12, fontWeight: 600,
                    }}>{totalVouchers}</span>
                  )}
                  <ChevronRight size={18} color={COLOR.muted} />
                </button>
              )}

              {/* Order History */}
              <button onClick={() => navigate('/orders')} style={menuRow}>
                <div style={iconBox}><ClipboardList size={18} color={COLOR.primary} /></div>
                <span style={{ flex: 1, color: COLOR.text, fontWeight: 500, fontSize: 15 }}>Order History</span>
                <ChevronRight size={18} color={COLOR.muted} />
              </button>
            </div>
          </div>

          {/* Settings */}
          <div>
            <div style={card}>
              <p style={{ margin: 0, padding: '12px 16px 0', fontSize: 11, color: COLOR.primary, fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '0.08em' }}>Settings</p>
              {/* Theme Toggle */}
              <div style={{ borderBottom: `1px solid ${COLOR.divider}` }}>
                <div style={{ ...menuRow, cursor: 'default' }}>
                  <div style={iconBox}>
                    {isDark ? <Moon size={18} color={COLOR.primary} /> : <Sun size={18} color={COLOR.primary} />}
                  </div>
                  <span style={{ flex: 1, color: COLOR.text, fontWeight: 500, fontSize: 15 }}>
                    {isDark ? 'Dark Mode' : 'Light Mode'}
                  </span>
                  <button
                    onClick={toggleTheme}
                    style={{
                      width: 44, height: 24, borderRadius: 12, border: 'none', cursor: 'pointer',
                      background: isDark ? COLOR.primary : 'rgba(0,0,0,0.15)',
                      position: 'relative', transition: 'background 0.25s',
                      flexShrink: 0,
                    }}
                  >
                    <span style={{
                      position: 'absolute', top: 3,
                      left: isDark ? 23 : 3,
                      width: 18, height: 18, borderRadius: '50%',
                      background: 'white',
                      transition: 'left 0.25s',
                      display: 'block',
                      boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                    }} />
                  </button>
                </div>
              </div>

              {/* Delivery Address */}
              <div style={{ borderBottom: `1px solid ${COLOR.divider}` }}>
                {editingAddress ? (
                  <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <div style={iconBox}><MapPin size={18} color={COLOR.primary} /></div>
                      <span style={{ color: COLOR.text, fontWeight: 500, fontSize: 15 }}>Delivery Address</span>
                    </div>
                    <input
                      value={addressInput}
                      onChange={e => setAddressInput(e.target.value)}
                      autoFocus
                      style={{
                        width: '100%', padding: '10px 12px', fontSize: 14,
                        background: COLOR.inputBg,
                        border: `1.5px solid ${COLOR.primary}`,
                        borderRadius: 10, color: COLOR.text, outline: 'none',
                        boxSizing: 'border-box',
                      }}
                    />
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button
                        onClick={handleSaveAddress}
                        disabled={savingAddress}
                        style={{
                          flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                          padding: '10px 0', borderRadius: 10, border: 'none', cursor: 'pointer',
                          background: 'linear-gradient(135deg, #00A0E9, #00CED1)',
                          color: 'white', fontWeight: 600, fontSize: 13,
                          opacity: savingAddress ? 0.6 : 1,
                        }}
                      >
                        <Check size={14} />
                        {savingAddress ? t('account.saving') : t('account.save')}
                      </button>
                      <button
                        onClick={() => { setAddressInput(customer.address); setEditingAddress(false); }}
                        style={{
                          flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                          padding: '10px 0', borderRadius: 10, cursor: 'pointer',
                          background: 'none', border: `1px solid ${COLOR.cardBorder}`,
                          color: COLOR.muted, fontSize: 13,
                        }}
                      >
                        <X size={14} />
                        {t('account.cancel')}
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => { setAddressInput(customer.address); setEditingAddress(true); }}
                    style={menuRow}
                  >
                    <div style={iconBox}><MapPin size={18} color={COLOR.primary} /></div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ color: COLOR.text, fontWeight: 500, fontSize: 15, margin: 0 }}>Delivery Address</p>
                      <p style={{ color: COLOR.muted, fontSize: 12, margin: '3px 0 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {addressInput}
                      </p>
                    </div>
                    <Pencil size={15} color={COLOR.muted} />
                  </button>
                )}
              </div>

              {/* Service Branch */}
              <button onClick={() => navigate('/select-branch')} style={menuRow}>
                <div style={iconBox}><Building2 size={18} color={COLOR.primary} /></div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ color: COLOR.text, fontWeight: 500, fontSize: 15, margin: 0 }}>Service Branch</p>
                  <p style={{ color: COLOR.muted, fontSize: 12, margin: '3px 0 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {customer.branch === 'Pending' ? t('account.pendingSetup') : customer.branch || t('account.notAssigned')}
                  </p>
                </div>
                <ChevronRight size={18} color={COLOR.muted} />
              </button>
            </div>
          </div>

          {/* Credit Limit (later_pay only) */}
          {customer.customer_type !== 'pre_pay' && customer.credit_limit != null && (
            <div>
              <div style={card}>
                <p style={{ margin: 0, padding: '12px 16px 0', fontSize: 11, color: COLOR.primary, fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '0.08em' }}>{t('home.creditLimit')}</p>
                <div style={{ padding: '4px 0' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <span style={{ color: COLOR.muted, fontSize: 13 }}>{t('home.creditUsed')}</span>
                    <span style={{ color: COLOR.text, fontSize: 13, fontWeight: 700 }}>
                      — / {new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(customer.credit_limit)}
                    </span>
                  </div>
                  <div style={{ height: 6, borderRadius: 99, background: COLOR.divider, overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: '0%', borderRadius: 99, background: COLOR.gradientPrimary }} />
                  </div>
                  <p style={{ color: COLOR.muted, fontSize: 11, margin: '6px 0 0' }}>
                    {t('home.creditLimit')}: {new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(customer.credit_limit)}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Contact */}
          <div>
            <div style={card}>
              <p style={{ margin: 0, padding: '12px 16px 0', fontSize: 11, color: COLOR.primary, fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '0.08em' }}>Contact</p>
              <div style={{ ...menuRow, cursor: 'default' }}>
                <div style={iconBox}><MessageCircle size={18} color={COLOR.primary} /></div>
                <div>
                  <p style={{ color: COLOR.text, fontWeight: 500, fontSize: 15, margin: 0 }}>WhatsApp</p>
                  <p style={{ color: COLOR.muted, fontSize: 12, margin: '3px 0 0' }}>{customer.whatsapp}</p>
                </div>
              </div>
            </div>
          </div>

          {/* Version */}
          <div style={{ textAlign: 'center', paddingTop: 8, paddingBottom: 8 }}>
            <p style={{ color: COLOR.muted, fontSize: 11, margin: 0 }}>VIVIDAQUA v1.0.0</p>
            <p style={{ color: COLOR.muted, fontSize: 11, margin: '4px 0 0' }}>The Purest Water</p>
          </div>
        </div>
      </div>

      <BottomNavV0 customer={customer} />
    </div>
  );
}
