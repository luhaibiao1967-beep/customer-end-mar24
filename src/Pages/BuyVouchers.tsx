// src/Pages/BuyVouchers.tsx - Buy per-product vouchers via Midtrans QRIS
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import BottomNav from '../Components/BottomNav';
import QrisPaymentModal from '../Components/QrisPaymentModal';
import { theme } from '../theme';

interface Customer {
  id: string;
  name: string;
  customer_type: string;
  voucher_balance: number;
}

interface BuyVouchersProps {
  customer: Customer;
}

interface VoucherPackage {
  id: string;
  product_id: string;
  qty: number;
  price: number;
  label: string;
  sort_order: number;
  products: { name: string } | null;
}

interface QrisState {
  qrCodeUrl: string;
  qrString?: string | null;
  midtransOrderId: string;
  amount: number;
}

export default function BuyVouchers({ customer }: BuyVouchersProps) {
  const navigate = useNavigate();
  const [packages, setPackages] = useState<VoucherPackage[]>([]);
  const [currentVouchers, setCurrentVouchers] = useState<Map<string, number>>(new Map());
  const [loading, setLoading] = useState(true);
  const [paying, setPaying] = useState<string | null>(null);
  const [qris, setQris] = useState<QrisState | null>(null);

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    try {
      const [pkgRes, vRes] = await Promise.all([
        supabase
          .from('voucher_packages')
          .select('id, product_id, qty, price, label, sort_order, products(name)')
          .eq('is_active', true)
          .order('sort_order'),
        supabase
          .from('customer_product_vouchers')
          .select('product_id, balance')
          .eq('customer_id', customer.id),
      ]);

      setPackages((pkgRes.data as VoucherPackage[]) || []);
      const map = new Map<string, number>();
      for (const row of vRes.data || []) map.set(row.product_id, row.balance);
      setCurrentVouchers(map);
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  };

  const handleBuy = async (pkg: VoucherPackage) => {
    setPaying(pkg.id);
    try {
      const token = sessionStorage.getItem('auth_token');
      if (!token) throw new Error('Session expired');

      const { data, error } = await supabase.functions.invoke('create-qris-payment', {
        body: { token, type: 'voucher', package_id: pkg.id },
      });

      if (error) throw new Error(error.message);
      if (!data?.success) throw new Error(data?.error || 'Failed to create QRIS payment');

      setQris({ qrCodeUrl: data.qr_code_url, qrString: data.qr_string, midtransOrderId: data.order_id, amount: data.amount });
    } catch (err: any) {
      alert('Error: ' + err.message);
    } finally {
      setPaying(null);
    }
  };

  const formatCurrency = (amount: number) =>
    new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(amount);

  if (customer.customer_type !== 'pre_pay') {
    return (
      <div style={{ minHeight: '100vh', background: theme.gradientPrimary, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
        <div style={{ background: 'white', borderRadius: '20px', padding: '40px', maxWidth: '500px', textAlign: 'center' }}>
          <p style={{ fontSize: '48px', margin: '0 0 20px 0' }}>ℹ️</p>
          <h2 style={{ fontSize: '24px', marginBottom: '15px' }}>Vouchers Not Available</h2>
          <p style={{ color: '#666', marginBottom: '30px' }}>Your account is postpaid mode.<br />Vouchers are only for prepaid customers.</p>
          <button onClick={() => navigate('/customer-home')} style={{ padding: '12px 30px', background: theme.gradientPrimary, color: 'white', border: 'none', borderRadius: '8px', fontSize: '16px', fontWeight: 'bold', cursor: 'pointer' }}>← Back to Home</button>
        </div>
        <BottomNav customer={customer} />
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: theme.gradientPrimary, padding: '20px', paddingBottom: '80px' }}>

      {/* Header */}
      <div style={{ maxWidth: '800px', margin: '0 auto 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <button onClick={() => navigate('/customer-home')} style={{ padding: '10px 20px', background: 'rgba(255,255,255,0.2)', color: 'white', border: '2px solid white', borderRadius: '8px', fontSize: '14px', fontWeight: 'bold', cursor: 'pointer' }}>← Back</button>
        <h1 style={{ color: 'white', fontSize: '22px', margin: 0 }}>🎫 Buy Vouchers</h1>
        <div style={{ width: '80px' }} />
      </div>

      <div style={{ maxWidth: '800px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '16px' }}>

        {/* Current voucher balances */}
        {currentVouchers.size > 0 && (
          <div style={{ background: 'white', borderRadius: '16px', padding: '16px 20px', boxShadow: '0 4px 20px rgba(0,0,0,0.15)' }}>
            <p style={{ margin: '0 0 10px 0', fontSize: '12px', color: theme.textMuted, fontWeight: '600' }}>Current Balance</p>
            {Array.from(currentVouchers.entries()).map(([productId, balance]) => {
              const pkg = packages.find(p => p.product_id === productId);
              return (
                <div key={productId} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '13px', color: theme.text }}>{pkg?.products?.name ?? '—'}</span>
                  <span style={{ fontSize: '22px', fontWeight: 'bold', color: theme.primary }}>{balance}</span>
                </div>
              );
            })}
          </div>
        )}

        {/* Packages */}
        {loading ? (
          <div style={{ background: 'white', borderRadius: '16px', padding: '40px', textAlign: 'center' }}>
            <p style={{ color: theme.textMuted }}>Loading packages...</p>
          </div>
        ) : packages.length === 0 ? (
          <div style={{ background: 'white', borderRadius: '16px', padding: '40px', textAlign: 'center' }}>
            <p style={{ color: theme.textMuted }}>No packages available.</p>
          </div>
        ) : (
          packages.map(pkg => (
            <div key={pkg.id} style={{ background: 'white', borderRadius: '16px', padding: '20px', boxShadow: '0 4px 20px rgba(0,0,0,0.12)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
                <div>
                  <p style={{ margin: 0, fontSize: '20px', fontWeight: 'bold', color: theme.text }}>{pkg.qty} Vouchers</p>
                  <p style={{ margin: '4px 0 0', fontSize: '12px', color: theme.textMuted }}>{pkg.label} · {pkg.products?.name}</p>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <p style={{ margin: 0, fontSize: '18px', fontWeight: 'bold', color: theme.primary }}>{formatCurrency(pkg.price)}</p>
                  <p style={{ margin: '2px 0 0', fontSize: '11px', color: theme.textMuted }}>{formatCurrency(Math.round(pkg.price / pkg.qty))}/voucher</p>
                </div>
              </div>
              <button
                onClick={() => handleBuy(pkg)}
                disabled={paying === pkg.id}
                style={{ width: '100%', padding: '12px', background: paying === pkg.id ? '#ccc' : theme.gradientPrimary, color: 'white', border: 'none', borderRadius: '8px', fontSize: '15px', fontWeight: 'bold', cursor: paying === pkg.id ? 'not-allowed' : 'pointer' }}
              >
                {paying === pkg.id ? 'Loading...' : 'Beli Sekarang'}
              </button>
            </div>
          ))
        )}

        <div style={{ background: 'rgba(255,255,255,0.15)', borderRadius: '12px', padding: '14px 16px', fontSize: '12px', color: 'rgba(255,255,255,0.9)' }}>
          ℹ️ Voucher otomatis ditambahkan setelah pembayaran berhasil.
        </div>
      </div>

      <BottomNav customer={customer} />

      {qris && (
        <QrisPaymentModal
          qrCodeUrl={qris.qrCodeUrl}
          qrString={qris.qrString}
          midtransOrderId={qris.midtransOrderId}
          amount={qris.amount}
          onSuccess={() => { setQris(null); loadData(); }}
          onClose={() => setQris(null)}
        />
      )}
    </div>
  );
}
