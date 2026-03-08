// src/Pages/BuyVouchers.tsx
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import BottomNav from '../Components/BottomNav';
import { theme } from '../theme';
import { formatCurrency } from '../utils/format';
import toast from 'react-hot-toast';
import { useLanguage } from '../contexts/LanguageContext';

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
  description: string | null;
  image_url: string | null;
  products: { name: string } | null;
}

interface Product {
  id: string;
  name: string;
  price: number;
  unit: string;
  is_refill: boolean;
  description: string | null;
  image_url: string | null;
}

// ─── Expandable info panel (image + description) ────────────────────────────
function InfoPanel({ description, imageUrl }: { description: string | null; imageUrl: string | null }) {
  if (!description && !imageUrl) return null;
  return (
    <div style={{
      borderTop: '1px solid #f0f0f0',
      marginTop: '14px',
      paddingTop: '14px',
    }}>
      {imageUrl && (
        <img
          src={imageUrl}
          alt=""
          style={{
            width: '100%',
            borderRadius: '10px',
            marginBottom: description ? '10px' : '0',
            objectFit: 'cover',
            maxHeight: '180px',
            display: 'block',
          }}
        />
      )}
      {description && (
        <p style={{ margin: 0, fontSize: '13px', color: '#555', lineHeight: '1.6' }}>
          {description}
        </p>
      )}
    </div>
  );
}

// ─── Info toggle button ──────────────────────────────────────────────────────
function InfoButton({ expanded, onClick }: { expanded: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        width: '28px',
        height: '28px',
        borderRadius: '50%',
        border: `1.5px solid ${theme.primary}`,
        background: expanded ? theme.primary : 'white',
        color: expanded ? 'white' : theme.primary,
        fontSize: '13px',
        fontWeight: 'bold',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        lineHeight: 1,
      }}
    >
      i
    </button>
  );
}

export default function BuyVouchers({ customer }: BuyVouchersProps) {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [packages, setPackages] = useState<VoucherPackage[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [currentVouchers, setCurrentVouchers] = useState<Map<string, number>>(new Map());
  const [productNames, setProductNames] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [paying, setPaying] = useState<string | null>(null);
  const [customQtys, setCustomQtys] = useState<Map<string, number>>(new Map());
  const [expandedPanels, setExpandedPanels] = useState<Set<string>>(new Set());

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    try {
      const [pkgRes, vRes, prodRes] = await Promise.all([
        supabase
          .from('voucher_packages')
          .select('id, product_id, qty, price, label, sort_order, description, image_url, products(name)')
          .eq('is_active', true)
          .order('sort_order'),
        supabase
          .from('customer_product_vouchers')
          .select('product_id, balance')
          .eq('customer_id', customer.id),
        supabase
          .from('products')
          .select('id, name, price, unit, is_refill, description, image_url')
          .eq('status', 'active')
          .eq('show_to_customers', true)
          .order('sort_order')
          .order('name'),
      ]);

      const pkgs = (pkgRes.data as VoucherPackage[]) || [];
      const prods = (prodRes.data as Product[]) || [];

      setPackages(pkgs);
      setProducts(prods);

      const nameMap = new Map<string, string>();
      for (const p of prods) nameMap.set(p.id, p.name);
      for (const pkg of pkgs) {
        if (pkg.products?.name) nameMap.set(pkg.product_id, pkg.products.name);
      }
      setProductNames(nameMap);

      const map = new Map<string, number>();
      for (const row of vRes.data || []) map.set(row.product_id, row.balance);
      setCurrentVouchers(map);
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  };

  const getQty = (key: string) => customQtys.get(key) ?? 1;
  const setQty = (key: string, delta: number) => {
    setCustomQtys(prev => {
      const next = new Map(prev);
      next.set(key, Math.max(1, (prev.get(key) ?? 1) + delta));
      return next;
    });
  };

  const toggleExpand = (id: string) => {
    setExpandedPanels(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const loadSnapScript = (clientKey: string, snapJsUrl: string): Promise<void> =>
    new Promise((resolve) => {
      if ((window as any).snap) { resolve(); return; }
      const existing = document.querySelector('script[data-midtrans-snap]');
      if (existing) { existing.addEventListener('load', () => resolve()); return; }
      const script = document.createElement('script');
      script.src = snapJsUrl;
      script.setAttribute('data-client-key', clientKey);
      script.setAttribute('data-midtrans-snap', 'true');
      script.onload = () => resolve();
      document.body.appendChild(script);
    });

  const handleBuyPackage = async (pkg: VoucherPackage) => {
    setPaying(pkg.id);
    try {
      const token = sessionStorage.getItem('auth_token');
      if (!token) throw new Error('Session expired');
      const { data, error } = await supabase.functions.invoke('create-voucher-payment', {
        body: { token, package_id: pkg.id },
      });
      if (error) throw new Error(error.message);
      if (!data?.success) throw new Error(data?.error || 'Failed to create payment');
      await loadSnapScript(data.client_key, data.snap_js_url);
      const orderId = data.midtrans_order_id;
      (window as any).snap.pay(data.snap_token, {
        onSuccess: async () => {
          // Optimistic UI update
          setCurrentVouchers(prev => {
            const next = new Map(prev);
            next.set(pkg.product_id, (prev.get(pkg.product_id) ?? 0) + pkg.qty);
            return next;
          });
          // Confirm with Midtrans API and write to DB
          const authToken = sessionStorage.getItem('auth_token');
          await supabase.functions.invoke('confirm-voucher-payment', {
            body: { token: authToken, midtrans_order_id: orderId },
          });
          toast.success(t('vouchers.paymentSuccess'));
          loadData();
        },
        onPending: () => { toast(t('vouchers.paymentPending'), { duration: 6000 }); },
        onError: (result: any) => { toast.error(t('vouchers.paymentFailed') + (result?.status_message || 'Unknown error')); },
        onClose: () => { /* user dismissed */ },
      });
    } catch (err: any) {
      toast.error(t('vouchers.paymentError') + err.message);
    } finally {
      setPaying(null);
    }
  };

  const handleBuyCustom = async (product: Product, qtyOverride?: number) => {
    const qty = qtyOverride ?? getQty(product.id);
    setPaying(`custom_${product.id}`);
    try {
      const token = sessionStorage.getItem('auth_token');
      if (!token) throw new Error('Session expired');
      const { data, error } = await supabase.functions.invoke('create-voucher-payment', {
        body: { token, product_id: product.id, qty },
      });
      if (error) throw new Error(error.message);
      if (!data?.success) throw new Error(data?.error || 'Failed to create payment');
      await loadSnapScript(data.client_key, data.snap_js_url);
      const orderId = data.midtrans_order_id;
      (window as any).snap.pay(data.snap_token, {
        onSuccess: async () => {
          // Optimistic UI update
          setCurrentVouchers(prev => {
            const next = new Map(prev);
            next.set(product.id, (prev.get(product.id) ?? 0) + qty);
            return next;
          });
          // Confirm with Midtrans API and write to DB
          const authToken = sessionStorage.getItem('auth_token');
          await supabase.functions.invoke('confirm-voucher-payment', {
            body: { token: authToken, midtrans_order_id: orderId },
          });
          toast.success(t('vouchers.paymentSuccess'));
          loadData();
        },
        onPending: () => { toast(t('vouchers.paymentPending'), { duration: 6000 }); },
        onError: (result: any) => { toast.error(t('vouchers.paymentFailed') + (result?.status_message || 'Unknown error')); },
        onClose: () => { /* user dismissed */ },
      });
    } catch (err: any) {
      toast.error(t('vouchers.paymentError') + err.message);
    } finally {
      setPaying(null);
    }
  };

  const singlePkg = packages.find(p => p.qty === 1) ?? null;
  const multiPackages = packages.filter(p => p.qty > 1);
  const productIdsWithPackages = new Set(packages.map(p => p.product_id));
  const otherProducts = products.filter(p => !productIdsWithPackages.has(p.id));

  if (customer.customer_type !== 'pre_pay') {
    return (
      <div style={{ minHeight: '100vh', background: theme.gradientPrimary, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
        <div style={{ background: 'white', borderRadius: '20px', padding: '40px', maxWidth: '500px', textAlign: 'center' }}>
          <p style={{ fontSize: '48px', margin: '0 0 20px 0' }}>ℹ️</p>
          <h2 style={{ fontSize: '24px', marginBottom: '15px' }}>{t('vouchers.notAvailable')}</h2>
          <p style={{ color: '#666', marginBottom: '30px' }}>{t('vouchers.postpaidMsg').split('\n')[0]}<br />{t('vouchers.postpaidMsg').split('\n')[1]}</p>
          <button onClick={() => navigate('/customer-home')} style={{ padding: '12px 30px', background: theme.gradientPrimary, color: 'white', border: 'none', borderRadius: '8px', fontSize: '16px', fontWeight: 'bold', cursor: 'pointer' }}>{t('vouchers.backToHome')}</button>
        </div>
        <BottomNav customer={customer} />
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: theme.gradientPrimary, padding: '20px', paddingBottom: '80px' }}>

      {/* Header */}
      <div style={{ maxWidth: '800px', margin: '0 auto 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <button onClick={() => navigate('/customer-home')} style={{ padding: '10px 20px', background: 'rgba(255,255,255,0.2)', color: 'white', border: '2px solid white', borderRadius: '8px', fontSize: '14px', fontWeight: 'bold', cursor: 'pointer' }}>← {t('common.back')}</button>
        <h1 style={{ color: 'white', fontSize: '22px', margin: 0 }}>🛒 {t('vouchers.title')}</h1>
        <div style={{ width: '80px' }} />
      </div>

      <div style={{ maxWidth: '800px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '16px' }}>

        {/* Current voucher balances */}
        {currentVouchers.size > 0 && (
          <div style={{ background: 'white', borderRadius: '16px', padding: '16px 20px', boxShadow: '0 4px 20px rgba(0,0,0,0.15)' }}>
            <p style={{ margin: '0 0 10px 0', fontSize: '12px', color: theme.textMuted, fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{t('vouchers.currentBalance')}</p>
            {Array.from(currentVouchers.entries()).map(([productId, balance]) => (
              <div key={productId} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0' }}>
                <span style={{ fontSize: '13px', color: theme.text }}>{productNames.get(productId) ?? '—'}</span>
                <span style={{ fontSize: '22px', fontWeight: 'bold', color: theme.primary }}>{balance}</span>
              </div>
            ))}
          </div>
        )}

        {loading ? (
          <div style={{ background: 'white', borderRadius: '16px', padding: '40px', textAlign: 'center' }}>
            <p style={{ color: theme.textMuted }}>{t('vouchers.loading')}</p>
          </div>
        ) : (
          <>
            {/* ── Refill Packages ── */}
            {packages.length > 0 && (
              <>
                <p style={{ color: 'rgba(255,255,255,0.7)', fontSize: '12px', margin: '0', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                  💧 {t('vouchers.refillPackages')}
                </p>

                {/* Single-unit: qty selector */}
                {singlePkg && (() => {
                  const qtyKey = singlePkg.product_id + '_single';
                  const qty = getQty(qtyKey);
                  const isPaying = paying === `custom_${singlePkg.product_id}`;
                  const product = products.find(p => p.id === singlePkg.product_id);
                  const hasInfo = !!(singlePkg.description || singlePkg.image_url);
                  const expanded = expandedPanels.has(singlePkg.id);
                  return (
                    <div style={{ background: 'white', borderRadius: '16px', padding: '20px', boxShadow: '0 4px 20px rgba(0,0,0,0.12)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
                        <div style={{ flex: 1 }}>
                          <p style={{ margin: 0, fontSize: '16px', fontWeight: 'bold', color: theme.text }}>{singlePkg.products?.name} — {t('vouchers.perVoucher')}</p>
                          <p style={{ margin: '4px 0 0', fontSize: '12px', color: theme.textMuted }}>{formatCurrency(singlePkg.price)} {t('vouchers.perVoucherPrice')}</p>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                          <p style={{ margin: 0, fontSize: '17px', fontWeight: 'bold', color: theme.primary }}>
                            {formatCurrency(singlePkg.price * qty)}
                          </p>
                          {hasInfo && <InfoButton expanded={expanded} onClick={() => toggleExpand(singlePkg.id)} />}
                        </div>
                      </div>
                      {expanded && <InfoPanel description={singlePkg.description} imageUrl={singlePkg.image_url} />}
                      <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginTop: expanded ? '14px' : '0' }}>
                        <div style={{ display: 'flex', alignItems: 'center', border: `1.5px solid ${theme.primary}`, borderRadius: '8px', overflow: 'hidden' }}>
                          <button onClick={() => setQty(qtyKey, -1)} style={{ width: '36px', height: '36px', background: 'white', border: 'none', fontSize: '18px', color: theme.primary, cursor: 'pointer', fontWeight: 'bold' }}>−</button>
                          <span style={{ minWidth: '32px', textAlign: 'center', fontSize: '15px', fontWeight: '600', color: theme.text }}>{qty}</span>
                          <button onClick={() => setQty(qtyKey, +1)} style={{ width: '36px', height: '36px', background: 'white', border: 'none', fontSize: '18px', color: theme.primary, cursor: 'pointer', fontWeight: 'bold' }}>+</button>
                        </div>
                        <button
                          onClick={() => product && handleBuyCustom(product, getQty(qtyKey))}
                          disabled={isPaying || !product}
                          style={{ flex: 1, padding: '10px', background: isPaying ? '#ccc' : theme.gradientPrimary, color: 'white', border: 'none', borderRadius: '8px', fontSize: '14px', fontWeight: 'bold', cursor: isPaying ? 'not-allowed' : 'pointer' }}
                        >
                          {isPaying ? t('vouchers.loadingPayment') : t('vouchers.buyNow')}
                        </button>
                      </div>
                    </div>
                  );
                })()}

                {/* Multi-qty: fixed price */}
                {multiPackages.map(pkg => {
                  const hasInfo = !!(pkg.description || pkg.image_url);
                  const expanded = expandedPanels.has(pkg.id);
                  return (
                    <div key={pkg.id} style={{ background: 'white', borderRadius: '16px', padding: '20px', boxShadow: '0 4px 20px rgba(0,0,0,0.12)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
                        <div style={{ flex: 1 }}>
                          <p style={{ margin: 0, fontSize: '20px', fontWeight: 'bold', color: theme.text }}>{pkg.qty} Vouchers</p>
                          <p style={{ margin: '4px 0 0', fontSize: '12px', color: theme.textMuted }}>{pkg.label} · {pkg.products?.name}</p>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                          <div style={{ textAlign: 'right' }}>
                            <p style={{ margin: 0, fontSize: '18px', fontWeight: 'bold', color: theme.primary }}>{formatCurrency(pkg.price)}</p>
                            <p style={{ margin: '2px 0 0', fontSize: '11px', color: theme.textMuted }}>{formatCurrency(Math.round(pkg.price / pkg.qty))}/voucher</p>
                          </div>
                          {hasInfo && <InfoButton expanded={expanded} onClick={() => toggleExpand(pkg.id)} />}
                        </div>
                      </div>
                      {expanded && <InfoPanel description={pkg.description} imageUrl={pkg.image_url} />}
                      <button
                        onClick={() => handleBuyPackage(pkg)}
                        disabled={paying === pkg.id}
                        style={{ width: '100%', padding: '12px', marginTop: expanded ? '14px' : '0', background: paying === pkg.id ? '#ccc' : theme.gradientPrimary, color: 'white', border: 'none', borderRadius: '8px', fontSize: '15px', fontWeight: 'bold', cursor: paying === pkg.id ? 'not-allowed' : 'pointer' }}
                      >
                        {paying === pkg.id ? t('vouchers.loadingPayment') : t('vouchers.buyNow')}
                      </button>
                    </div>
                  );
                })}
              </>
            )}

            {/* ── Other Products ── */}
            {otherProducts.length > 0 && (
              <>
                <p style={{ color: 'rgba(255,255,255,0.7)', fontSize: '12px', margin: '4px 0 0', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                  🛍️ {t('vouchers.otherProducts')}
                </p>
                {otherProducts.map(product => {
                  const qty = getQty(product.id);
                  const isPaying = paying === `custom_${product.id}`;
                  const hasInfo = !!(product.description || product.image_url);
                  const expanded = expandedPanels.has(product.id);
                  return (
                    <div key={product.id} style={{ background: 'white', borderRadius: '16px', padding: '20px', boxShadow: '0 4px 20px rgba(0,0,0,0.12)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
                        <div style={{ flex: 1 }}>
                          <p style={{ margin: 0, fontSize: '16px', fontWeight: 'bold', color: theme.text }}>{product.name}</p>
                          <p style={{ margin: '4px 0 0', fontSize: '12px', color: theme.textMuted }}>{formatCurrency(product.price)} / {product.unit}</p>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                          <p style={{ margin: 0, fontSize: '17px', fontWeight: 'bold', color: theme.primary }}>
                            {formatCurrency(product.price * qty)}
                          </p>
                          {hasInfo && <InfoButton expanded={expanded} onClick={() => toggleExpand(product.id)} />}
                        </div>
                      </div>
                      {expanded && <InfoPanel description={product.description} imageUrl={product.image_url} />}
                      <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginTop: expanded ? '14px' : '0' }}>
                        <div style={{ display: 'flex', alignItems: 'center', border: `1.5px solid ${theme.primary}`, borderRadius: '8px', overflow: 'hidden' }}>
                          <button onClick={() => setQty(product.id, -1)} style={{ width: '36px', height: '36px', background: 'white', border: 'none', fontSize: '18px', color: theme.primary, cursor: 'pointer', fontWeight: 'bold' }}>−</button>
                          <span style={{ minWidth: '32px', textAlign: 'center', fontSize: '15px', fontWeight: '600', color: theme.text }}>{qty}</span>
                          <button onClick={() => setQty(product.id, +1)} style={{ width: '36px', height: '36px', background: 'white', border: 'none', fontSize: '18px', color: theme.primary, cursor: 'pointer', fontWeight: 'bold' }}>+</button>
                        </div>
                        <button
                          onClick={() => handleBuyCustom(product)}
                          disabled={isPaying}
                          style={{ flex: 1, padding: '10px', background: isPaying ? '#ccc' : theme.gradientPrimary, color: 'white', border: 'none', borderRadius: '8px', fontSize: '14px', fontWeight: 'bold', cursor: isPaying ? 'not-allowed' : 'pointer' }}
                        >
                          {isPaying ? t('vouchers.loadingPayment') : t('vouchers.buyNow')}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </>
            )}

            {packages.length === 0 && otherProducts.length === 0 && (
              <div style={{ background: 'white', borderRadius: '16px', padding: '40px', textAlign: 'center' }}>
                <p style={{ color: theme.textMuted }}>{t('vouchers.noProducts')}</p>
              </div>
            )}
          </>
        )}

        <div style={{ background: 'rgba(255,255,255,0.15)', borderRadius: '12px', padding: '14px 16px', fontSize: '12px', color: 'rgba(255,255,255,0.9)' }}>
          ℹ️ {t('vouchers.autoAdd')}
        </div>
      </div>

      <BottomNav customer={customer} />

    </div>
  );
}
