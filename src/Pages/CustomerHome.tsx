// src/Pages/CustomerHome.tsx - v0 style redesign
import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { QRCodeCanvas } from 'qrcode.react';
import { supabase } from '../supabaseClient';
import BottomNavV0 from '../Components/BottomNavV0';
import TopNavV0 from '../Components/TopNavV0';
import VividAquaProductCard from '../Components/VividAquaProductCard';
import { formatCurrency } from '../utils/format';
import { useLanguage } from '../contexts/LanguageContext';
import { Ticket, Droplets, ChevronRight } from 'lucide-react';
import { theme } from '../theme';
import { useColorTokens } from '../contexts/ColorTokensContext';
import { markLogoutForPwaPrompt } from '../utils/pwaInstall';
import { filterAndSortOrderableProducts } from '../utils/orderableProducts';

const APP_URL = 'https://vividaqua.online/';

/** Bump when replacing `/public` pack JPGs so browsers/CDNs fetch new bytes (same filename). */
const VOUCHER_PACK_IMAGE_V = '2';

function publicPackAssetUrl(base: string, filename: string): string {
  const root = base.endsWith('/') ? base : `${base}/`;
  return `${root}${encodeURIComponent(filename)}?v=${VOUCHER_PACK_IMAGE_V}`;
}

const loadImage = (src: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });

const drawRoundRect = (
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number, r: number
) => {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
};

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

interface Order {
  id: string;
  customer_name: string;
  customer_address: string;
  delivery_date: string;
  status: string;
  payment_status: string;
  total_amount: number;
  created_at: string;
}

interface CustomerHomeProps {
  customer: Customer;
}

interface ProductVoucherRow {
  product_id: string;
  balance: number;
  products: { name: string } | null;
}

interface VoucherSlide {
  id: string;
  title: string;
  tickets: number;
  subtitle: string;
  badge: string;
  /** /public pack art (spaces OK — encoded in URL) */
  packImage: string;
}

interface OrderGalleryProduct {
  id: string;
  name: string;
  price: number;
  unit: string;
  is_refill: boolean;
  image_url: string | null;
}

function weekdayFromYmd(ymd: string): number {
  return new Date(`${ymd}T12:00:00+07:00`).getUTCDay();
}

function addDaysYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days, 12, 0, 0));
  return dt.toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
}

function jakartaTodayYmd(now = new Date()): string {
  return now.toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
}

function graceUntilByTerm(termRaw: unknown, orderYmd: string): string {
  const term = typeof termRaw === 'string' ? termRaw.toLowerCase() : '';
  if (term === 'daily') return orderYmd;
  if (term === 'weekly') {
    const day = weekdayFromYmd(orderYmd);
    const iso = day === 0 ? 7 : day;
    return addDaysYmd(orderYmd, 14 - iso);
  }
  if (term === 'monthly') {
    const [y, m] = orderYmd.split('-');
    return `${y}-${m}-20`;
  }
  if (term === 'quarterly') {
    const [ys, ms] = orderYmd.split('-');
    const year = Number(ys);
    const month = Number(ms);
    const quarterStartMonth = Math.floor((month - 1) / 3) * 3 + 1;
    let targetYear = year;
    let targetMonth = quarterStartMonth + 4;
    if (targetMonth > 12) {
      targetMonth -= 12;
      targetYear += 1;
    }
    const firstOfFollowing = new Date(Date.UTC(targetYear, targetMonth, 1, 12, 0, 0));
    firstOfFollowing.setUTCDate(firstOfFollowing.getUTCDate() - 1);
    return firstOfFollowing.toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
  }
  return orderYmd;
}

function getOutstandingBlockCode(
  termRaw: unknown,
  orders: { payment_status?: string; status?: string; delivery_date?: string }[],
): string | null {
  const term = typeof termRaw === 'string' ? termRaw.toLowerCase() : '';
  const todayYmd = jakartaTodayYmd();
  const blocked = orders.some((o) => {
    if (o.payment_status !== 'unpaid') return false;
    if (o.status !== 'delivered') return false;
    if (!o.delivery_date) return false;
    return todayYmd > graceUntilByTerm(termRaw, o.delivery_date);
  });
  if (!blocked) return null;
  if (term === 'daily') return 'OUTSTANDING_PAYMENT_BLOCKED_DAILY';
  if (term === 'weekly') return 'OUTSTANDING_PAYMENT_BLOCKED_WEEKLY';
  if (term === 'monthly') return 'OUTSTANDING_PAYMENT_BLOCKED_MONTHLY';
  if (term === 'quarterly') return 'OUTSTANDING_PAYMENT_BLOCKED_QUARTERLY';
  return 'OUTSTANDING_PAYMENT_BLOCKED';
}

function outstandingMessageKey(errorCode: string | null): string {
  if (errorCode === 'OUTSTANDING_PAYMENT_BLOCKED_DAILY') return 'placeOrder.outstandingDescDaily';
  if (errorCode === 'OUTSTANDING_PAYMENT_BLOCKED_WEEKLY') return 'placeOrder.outstandingDescWeekly';
  if (errorCode === 'OUTSTANDING_PAYMENT_BLOCKED_MONTHLY') return 'placeOrder.outstandingDescMonthly';
  if (errorCode === 'OUTSTANDING_PAYMENT_BLOCKED_QUARTERLY') return 'placeOrder.outstandingDescQuarterly';
  return 'placeOrder.outstandingDesc';
}


export default function CustomerHome({ customer }: CustomerHomeProps) {
  const navigate = useNavigate();
  const { t } = useLanguage();
  const { tokens: C, isDark } = useColorTokens();
  const [loading, setLoading] = useState(false);
  const [activeVoucherSlide, setActiveVoucherSlide] = useState(0);
  const [pendingOrders, setPendingOrders] = useState<Order[]>([]);
  const [productVouchers, setProductVouchers] = useState<ProductVoucherRow[]>([]);
  const [unpaidAmount, setUnpaidAmount] = useState(0);
  const [creditLimit, setCreditLimit] = useState<number | null>(null);
  const [lastDeliveryDate, setLastDeliveryDate] = useState<string | null>(null);
  const [paymentTerm, setPaymentTerm] = useState<string>('');
  const [outstandingBlockCode, setOutstandingBlockCode] = useState<string | null>(null);
  const [orderGalleryProducts, setOrderGalleryProducts] = useState<OrderGalleryProduct[]>([]);
  const [orderGalleryLoading, setOrderGalleryLoading] = useState(false);
  const qrRef = useRef<HTMLCanvasElement>(null);
  const canOrder = customer.branch && customer.branch !== 'Pending';
  const isPrePay = customer.customer_type === 'pre_pay';

  const base = import.meta.env.BASE_URL;
  const voucherSlides: VoucherSlide[] = [
    {
      id: 'voucher-10',
      title: 'Paket 10 Voucher',
      tickets: 10,
      subtitle: 'Cocok untuk kebutuhan rumah tangga ringan',
      badge: 'Starter',
      packImage: publicPackAssetUrl(base, '10 Pack Indonesia.jpg'),
    },
    {
      id: 'voucher-20',
      title: 'Paket 20 Voucher',
      tickets: 20,
      subtitle: 'Pilihan paling hemat untuk pemakaian rutin',
      badge: 'Best Value',
      packImage: publicPackAssetUrl(base, '20 Pack Indonesia.jpg'),
    },
    {
      id: 'voucher-50',
      title: 'Paket 50 Voucher',
      tickets: 50,
      subtitle: 'Untuk keluarga besar atau kebutuhan usaha',
      badge: 'Bulk Save',
      packImage: publicPackAssetUrl(base, '50 Pack Indonesia.jpg'),
    },
  ];

  // Product Gallery packages
  const galleryItems = [
    { title: 'Starter Pack', subtitle: '10 vouchers', count: 10 },
    { title: 'Value Pack', subtitle: '20 vouchers', count: 20 },
    { title: 'Bulk Pack', subtitle: '50 vouchers', count: 50 },
    { title: 'Custom Order', subtitle: 'Order anytime', count: null },
  ];

  const generateShareImage = async (): Promise<Blob | null> => {
    const qrCanvas = qrRef.current;
    if (!qrCanvas) return null;
    const W = 540, H = 780;
    const offscreen = document.createElement('canvas');
    offscreen.width = W; offscreen.height = H;
    const ctx = offscreen.getContext('2d');
    if (!ctx) return null;
    const bg = ctx.createLinearGradient(0, 0, W, H);
    bg.addColorStop(0, '#4f46e5'); bg.addColorStop(0.55, '#7c3aed'); bg.addColorStop(1, '#a21caf');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
    ctx.save(); ctx.globalAlpha = 0.13; ctx.fillStyle = 'white';
    ctx.beginPath(); ctx.arc(W * 0.92, -10, 180, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(-20, H * 0.35, 110, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    try {
      const logo = await loadImage(`${import.meta.env.BASE_URL}logo.png`);
      const logoH = 58, logoW = (logo.width / logo.height) * logoH;
      ctx.drawImage(logo, (W - logoW) / 2, 46, logoW, logoH);
    } catch { }
    ctx.fillStyle = 'white'; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    ctx.font = 'bold 42px -apple-system, sans-serif'; ctx.fillText('VividAqua', W / 2, 164);
    const cardX = 44, cardY = 228, cardW = W - 88, cardH = 352;
    ctx.save(); ctx.shadowColor = 'rgba(0,0,0,0.3)'; ctx.shadowBlur = 32; ctx.shadowOffsetY = 10;
    ctx.fillStyle = 'white'; drawRoundRect(ctx, cardX, cardY, cardW, cardH, 24); ctx.fill(); ctx.restore();
    const qrSize = 216, qrX = (W - qrSize) / 2, qrY = cardY + 46;
    ctx.drawImage(qrCanvas, qrX, qrY, qrSize, qrSize);
    return new Promise(resolve => offscreen.toBlob(resolve, 'image/png'));
  };

  useEffect(() => {
    loadHomeData();
    loadProductVouchers();
  }, [customer.id]);

  useEffect(() => {
    if (isPrePay) return;
    let cancelled = false;
    (async () => {
      setOrderGalleryLoading(true);
      try {
        const { data, error } = await supabase
          .from('products')
          .select('id, name, price, unit, is_refill, image_url')
          .eq('status', 'active');
        if (error) throw error;
        const list = filterAndSortOrderableProducts((data ?? []) as OrderGalleryProduct[], customer.branch);
        if (!cancelled) setOrderGalleryProducts(list);
      } catch {
        if (!cancelled) setOrderGalleryProducts([]);
      } finally {
        if (!cancelled) setOrderGalleryLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isPrePay, customer.branch]);

  useEffect(() => {
    if (!isPrePay) return;
    const timer = window.setInterval(() => {
      setActiveVoucherSlide(prev => (prev + 1) % voucherSlides.length);
    }, 4000);
    return () => window.clearInterval(timer);
  }, [isPrePay, voucherSlides.length]);

  const loadHomeData = async () => {
    try {
      const token = sessionStorage.getItem('auth_token');
      if (!token) return;
      const { data, error } = await supabase.functions.invoke('get-home-data', { body: { token } });
      if (error || !data?.success) return;
      setPendingOrders(data.pending_orders || []);
      setLastDeliveryDate(data.last_delivery_date ?? null);
      setUnpaidAmount(data.unpaid_amount ?? 0);
      setCreditLimit(data.credit_limit ?? null);
      setPaymentTerm(data.payment_term || 'daily');
      if (customer.customer_type !== 'pre_pay') {
        const ordersRes = await supabase.functions.invoke('get-orders', { body: { token, limit: 80 } });
        if (ordersRes.data?.success) {
          setOutstandingBlockCode(getOutstandingBlockCode(data.payment_term || 'daily', ordersRes.data.orders || []));
        }
      }
    } catch { }
  };

  const loadProductVouchers = async () => {
    try {
      const { data } = await supabase
        .from('customer_product_vouchers')
        .select('product_id, balance, products(name)')
        .eq('customer_id', customer.id);
      setProductVouchers((data as unknown as ProductVoucherRow[]) || []);
    } catch { }
  };

  const handleSignOut = () => {
    setLoading(true);
    markLogoutForPwaPrompt();
    sessionStorage.removeItem('customer');
    sessionStorage.removeItem('auth_token');
    sessionStorage.removeItem('authenticated');
    window.dispatchEvent(new Event('session-auth-updated'));
    navigate('/', { replace: true });
  };

  const formatDate = (dateString: string) =>
    new Date(dateString).toLocaleDateString('id-ID', { timeZone: 'Asia/Jakarta', year: 'numeric', month: 'long', day: 'numeric' });

  const getStatusColor = (status: string) =>
    status === 'pending' ? theme.warning : status === 'scheduled' ? theme.info : '#999';

  const getStatusLabel = (status: string) =>
    status === 'pending' ? t('home.statusPending') : status === 'scheduled' ? t('home.statusScheduled') : status.toUpperCase();

  const totalVouchers = productVouchers.reduce((sum, v) => sum + v.balance, 0);
  const pendingCount = pendingOrders.filter(o => o.status === 'pending').length;

  return (
    <div style={{ minHeight: '100vh', background: C.pageBg }}>
      <TopNavV0 customerName={customer.name} onSignOut={handleSignOut} loading={loading} />

      {/* Hidden QR canvas for share feature */}
      <div style={{ position: 'absolute', left: -9999, top: -9999, pointerEvents: 'none' }}>
        <QRCodeCanvas ref={qrRef} value={APP_URL} size={216} level="H"
          imageSettings={{ src: `${import.meta.env.BASE_URL}shortcut.png`, width: 60, height: 60, excavate: true }}
        />
      </div>

      <div style={{ maxWidth: 430, margin: '0 auto', padding: '60px 14px 88px', display: 'flex', flexDirection: 'column', gap: 6 }}>

        {/* ── 1. Promo Slideshow ── */}
        {isPrePay && (
        <div style={{
          background: isDark
            ? 'linear-gradient(170deg, #020f28 0%, #031739 52%, #062451 100%)'
            : 'rgba(255,255,255,0.18)',
          borderRadius: 20,
          boxShadow: isDark ? '0 16px 36px rgba(2,15,40,0.38)' : '0 8px 24px rgba(0,0,0,0.12)',
          overflow: 'hidden',
          border: `1px solid ${C.cardBorder}`,
          backdropFilter: isDark ? 'none' : 'blur(8px)',
        }}>
          <div style={{ padding: '10px 16px 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <p style={{
              margin: 0, fontSize: 12, letterSpacing: '0.03em', fontWeight: 700,
              background: C.gradientPrimary, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
            }}>
              VIVIDAQUA PROMO PACKAGES
            </p>
            <span style={{
              fontSize: 11, fontWeight: 600,
              background: C.gradientPrimary, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
            }}>Swipe / Auto Slide</span>
          </div>
          <div style={{ overflow: 'hidden', padding: '4px 8px 0' }}>
            <div style={{
              display: 'flex',
              width: `${voucherSlides.length * 100}%`,
              transform: `translateX(-${activeVoucherSlide * (100 / voucherSlides.length)}%)`,
              transition: 'transform 420ms ease',
            }}>
              {voucherSlides.map(slide => (
                <div key={slide.id} style={{ width: `${100 / voucherSlides.length}%`, padding: '4px 4px 8px', boxSizing: 'border-box' }}>
                  <VividAquaProductCard
                    title={slide.title}
                    ticketCount={slide.tickets}
                    subtitle={slide.subtitle}
                    badge={slide.badge}
                    packImage={slide.packImage}
                    imageOnly
                    onBuy={() => navigate('/buy-vouchers')}
                  />
                </div>
              ))}
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'center', gap: 8, padding: '0 0 11px' }}>
            {voucherSlides.map((slide, idx) => (
              <button
                key={slide.id}
                type="button"
                onClick={() => setActiveVoucherSlide(idx)}
                style={{
                  width: activeVoucherSlide === idx ? 20 : 8, height: 8,
                  borderRadius: 999, border: 'none',
                  background: activeVoucherSlide === idx ? 'white' : 'rgba(255,255,255,0.45)',
                  cursor: 'pointer', transition: 'all 220ms ease',
                }}
              />
            ))}
          </div>
        </div>
        )}

        {/* ── 2. Quick Actions ── */}
        <div style={{ display: 'grid', gridTemplateColumns: isPrePay ? '1fr 1fr' : '1fr', gap: 8 }}>
          {/* Buy Vouchers */}
          {isPrePay && (
          <button
              onClick={() => navigate('/buy-vouchers')}
              style={{
                padding: 12, borderRadius: 14,
                background: C.card, border: `1px solid ${C.cardBorder}`,
                backdropFilter: C.cardBlur, WebkitBackdropFilter: C.cardBlur,
                boxShadow: C.cardShadow,
                cursor: 'pointer', textAlign: 'left',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{
                  width: 48, height: 48, borderRadius: 14,
                  background: C.gradientPrimary,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                }}>
                  <Ticket size={22} color="white" />
                </div>
                <div>
                  <p style={{ color: C.text, fontWeight: 600, fontSize: 14, margin: 0 }}>Buy Vouchers</p>
                  <p style={{ color: C.muted, fontSize: 11, margin: '2px 0 0' }}>Save more</p>
                </div>
              </div>
            </button>
          )}

          {/* Order Delivery */}
          <button
            onClick={() => canOrder && navigate('/place-order')}
            style={{
              padding: 12, borderRadius: 14,
              background: C.card, border: `1px solid ${canOrder ? C.cardBorder : C.divider}`,
              backdropFilter: C.cardBlur, WebkitBackdropFilter: C.cardBlur,
              boxShadow: C.cardShadow,
              cursor: canOrder ? 'pointer' : 'not-allowed',
              textAlign: 'left',
              opacity: canOrder ? 1 : 0.6,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{
                width: 48, height: 48, borderRadius: 14,
                background: C.gradientPrimary,
                display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
              }}>
                <Droplets size={22} color="white" />
              </div>
              <div>
                <p style={{ color: C.text, fontWeight: 600, fontSize: 14, margin: 0 }}>Order Delivery</p>
                <p style={{ color: C.muted, fontSize: 11, margin: '2px 0 0' }}>Fast delivery</p>
              </div>
            </div>
          </button>
        </div>

        {/* ── 3. My Account Overview ── */}
        <div style={{ background: C.card, border: `1px solid ${C.cardBorder}`, borderRadius: 16, padding: 12, backdropFilter: C.cardBlur, WebkitBackdropFilter: C.cardBlur, boxShadow: C.cardShadow }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <p style={{ color: C.text, fontWeight: 600, fontSize: 15, margin: 0 }}>My Account</p>
            <button
              onClick={() => navigate('/account')}
              style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'none', border: 'none', color: C.primary, fontSize: 12, cursor: 'pointer' }}
            >
              View Details <ChevronRight size={13} />
            </button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, textAlign: 'center' }}>
            <div>
              <p style={{
                fontSize: 26, fontWeight: 900, margin: 0,
                background: C.gradientPrimary,
                WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
              }}>
                {totalVouchers}
              </p>
              <p style={{ color: C.muted, fontSize: 11, margin: '4px 0 0' }}>Vouchers</p>
            </div>
            <div>
              <p style={{
                fontSize: 26, fontWeight: 900, margin: 0,
                background: C.gradientPrimary,
                WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
              }}>
                {pendingCount}
              </p>
              <p style={{ color: C.muted, fontSize: 11, margin: '4px 0 0' }}>Delivery</p>
            </div>
            <div>
              {customer.customer_type !== 'pre_pay' ? (
                <>
                  <p style={{ fontSize: unpaidAmount > 0 ? 16 : 26, fontWeight: 700, margin: 0, color: unpaidAmount > 0 ? '#ef4444' : C.primary }}>
                    {unpaidAmount > 0 ? formatCurrency(unpaidAmount) : '0'}
                  </p>
                  <p style={{ color: C.muted, fontSize: 11, margin: '4px 0 0' }}>Unpaid</p>
                </>
              ) : (
                <>
                  <p style={{ fontSize: 26, fontWeight: 700, margin: 0, background: 'linear-gradient(135deg, #00A0E9, #00CED1)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
                    0
                  </p>
                  <p style={{ color: C.muted, fontSize: 11, margin: '4px 0 0' }}>Points</p>
                </>
              )}
            </div>
          </div>
        </div>

        {/* ── 4. Pending Orders ── */}
        {pendingOrders.length > 0 && (
          <div style={{
            background: C.card, border: `1px solid ${C.cardBorder}`,
            borderRadius: 14, padding: 12,
            backdropFilter: C.cardBlur, WebkitBackdropFilter: C.cardBlur,
          }}>
            <p style={{ color: C.text, fontWeight: 700, fontSize: 15, margin: '0 0 8px' }}>
              {t('home.pendingOrders')}
            </p>
            {pendingOrders.map(order => (
              <div key={order.id} style={{
                background: C.card,
                border: `1px solid ${getStatusColor(order.status)}`,
                borderRadius: 14, padding: 12, marginBottom: 6,
                backdropFilter: C.cardBlur, WebkitBackdropFilter: C.cardBlur,
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: 8 }}>
                  <div>
                    <span style={{
                      display: 'inline-block',
                      background: getStatusColor(order.status), color: 'white',
                      padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700, marginBottom: 6,
                    }}>
                      {getStatusLabel(order.status)}
                    </span>
                    <p style={{ color: C.muted, fontSize: 13, margin: '4px 0' }}>
                      {t('home.delivery')}: <strong style={{ color: C.text }}>{formatDate(order.delivery_date)}</strong>
                    </p>
                    <p style={{ color: theme.success, fontSize: 15, fontWeight: 700, margin: '4px 0 0' }}>
                      {formatCurrency(order.total_amount)}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => navigate(`/orders/${order.id}/delivery`)}
                  style={{ width: '100%', padding: '9px', background: C.primaryBg, color: C.primary, border: `1px solid ${C.primaryBorder}`, borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer' }}
                >
                  {t('home.details')} →
                </button>
              </div>
            ))}
          </div>
        )}

        {/* ── 5. Credit Limit + Unpaid Warning (later_pay) ── */}
        {customer.customer_type !== 'pre_pay' && (unpaidAmount > 0 || creditLimit !== null) && (
          <div style={{
            background: unpaidAmount > 0 ? 'rgba(234,88,12,0.12)' : C.primaryBg,
            border: `1px solid ${unpaidAmount > 0 ? 'rgba(251,146,60,0.4)' : C.primaryBorder}`,
            borderRadius: 14, padding: 12,
          }}>
            {/* Credit limit bar */}
            {creditLimit !== null && (
              <div style={{ marginBottom: unpaidAmount > 0 ? 8 : 0 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <p style={{ color: C.muted, fontSize: 12, margin: 0 }}>{t('home.creditUsed')}</p>
                  <p style={{ color: C.text, fontSize: 12, fontWeight: 700, margin: 0 }}>
                    {formatCurrency(unpaidAmount)} / {formatCurrency(creditLimit)}
                  </p>
                </div>
                <div style={{ height: 6, borderRadius: 99, background: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)', overflow: 'hidden' }}>
                  <div style={{
                    height: '100%', borderRadius: 99,
                    width: `${Math.min(100, creditLimit > 0 ? (unpaidAmount / creditLimit) * 100 : 0)}%`,
                    background: unpaidAmount / creditLimit > 0.8 ? '#ef4444' : unpaidAmount / creditLimit > 0.5 ? '#f97316' : C.primary,
                    transition: 'width 0.5s ease',
                  }} />
                </div>
              </div>
            )}
            {unpaidAmount > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <p style={{ color: C.muted, fontSize: 12, margin: 0 }}>{t('home.unpaidAmount')}</p>
                  <p style={{ color: '#ef4444', fontSize: 16, fontWeight: 700, margin: '4px 0 0' }}>
                    {formatCurrency(unpaidAmount)}
                  </p>
                  <p style={{ color: theme.error, fontSize: 11, margin: '6px 0 0', maxWidth: 220 }}>
                    {t(outstandingMessageKey(outstandingBlockCode))}
                  </p>
                </div>
                <button
                  onClick={() => navigate('/orders')}
                  style={{ padding: '8px 14px', background: C.primary, color: 'white', border: 'none', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}
                >
                  {t('home.payNow')} →
                </button>
              </div>
            )}
          </div>
        )}

        {/* ── 6. Product Gallery (inside card panel for contrast on busy background) ── */}
        <div style={{
          background: C.card, border: `1px solid ${C.cardBorder}`, borderRadius: 16, padding: 12,
          backdropFilter: C.cardBlur, WebkitBackdropFilter: C.cardBlur, boxShadow: C.cardShadow,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <p style={{ color: C.text, fontWeight: 600, fontSize: 15, margin: 0 }}>Product Gallery</p>
            <span style={{ color: C.muted, fontSize: 11 }}>Swipe to see more</span>
          </div>
          <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 2, scrollbarWidth: 'none' }}>
            {isPrePay ? (
              galleryItems.map((item, i) => (
                <button
                  key={i}
                  onClick={() => {
                    const goVouchers = item.count != null;
                    navigate(goVouchers ? '/buy-vouchers' : '/place-order');
                  }}
                  style={{
                    flexShrink: 0, width: 120,
                    background: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.85)',
                    border: `1px solid ${C.cardBorder}`,
                    borderRadius: 14, overflow: 'hidden', cursor: 'pointer', textAlign: 'left',
                  }}
                >
                  <div style={{
                    aspectRatio: '1', background: 'linear-gradient(135deg, rgba(77,204,204,0.12), rgba(0,139,139,0.15))',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    {item.count ? (
                      <div style={{ textAlign: 'center' }}>
                        <Ticket size={28} color={C.primary} style={{ opacity: 0.7 }} />
                        <p style={{
                          fontSize: 22, fontWeight: 800, margin: '4px 0 0',
                          background: C.gradientPrimary,
                          WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
                        }}>{item.count}</p>
                      </div>
                    ) : (
                      <Droplets size={32} color={C.primary} style={{ opacity: 0.6 }} />
                    )}
                  </div>
                  <div style={{ padding: '10px 12px' }}>
                    <p style={{ color: C.text, fontWeight: 600, fontSize: 12, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {item.title}
                    </p>
                    <p style={{ color: C.muted, fontSize: 11, margin: '3px 0 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {item.subtitle}
                    </p>
                  </div>
                </button>
              ))
            ) : orderGalleryLoading ? (
              <p style={{ color: C.muted, fontSize: 13, margin: 0, padding: '8px 4px' }}>{t('common.loading')}</p>
            ) : orderGalleryProducts.length === 0 ? (
              <p style={{ color: C.muted, fontSize: 13, margin: 0, padding: '8px 4px' }}>{t('home.galleryNoOrderableProducts')}</p>
            ) : (
              orderGalleryProducts.map((product) => (
                <button
                  key={product.id}
                  type="button"
                  onClick={() => navigate('/place-order')}
                  style={{
                    flexShrink: 0, width: 120,
                    background: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.85)',
                    border: `1px solid ${C.cardBorder}`,
                    borderRadius: 14, overflow: 'hidden', cursor: 'pointer', textAlign: 'left',
                  }}
                >
                  <div style={{
                    aspectRatio: '1',
                    background: 'linear-gradient(135deg, rgba(77,204,204,0.12), rgba(0,139,139,0.15))',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    overflow: 'hidden',
                  }}>
                    {product.image_url ? (
                      <img src={product.image_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    ) : (
                      <Droplets size={32} color={C.primary} style={{ opacity: 0.6 }} />
                    )}
                  </div>
                  <div style={{ padding: '10px 12px' }}>
                    <p style={{ color: C.text, fontWeight: 600, fontSize: 12, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {product.name}
                    </p>
                    <p style={{ color: C.muted, fontSize: 11, margin: '3px 0 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {formatCurrency(product.price)} · {product.unit}
                    </p>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>

        {/* ── 7. Share App / QR ── */}
        <div style={{ background: C.card, border: `1px solid ${C.cardBorder}`, borderRadius: 16, padding: 14, textAlign: 'center', backdropFilter: C.cardBlur, WebkitBackdropFilter: C.cardBlur, boxShadow: C.cardShadow }}>
          <p style={{ color: C.text, fontWeight: 600, fontSize: 15, margin: '0 0 2px' }}>{t('home.shareApp')}</p>
          <p style={{ color: C.muted, fontSize: 12, margin: '0 0 10px' }}>{t('home.scanShare')}</p>
          <div style={{ display: 'inline-block', padding: 10, background: isDark ? 'rgba(255,255,255,0.06)' : '#f5f5f5', border: `1px solid ${C.cardBorder}`, borderRadius: 12, marginBottom: 10 }}>
            <QRCodeCanvas value={APP_URL} size={140} level="H" bgColor={isDark ? 'transparent' : '#f5f5f5'} fgColor={isDark ? 'white' : '#333333'}
              imageSettings={{ src: `${import.meta.env.BASE_URL}shortcut.png`, width: 40, height: 40, excavate: true }}
            />
          </div>
          <p style={{ color: C.muted, fontSize: 11, margin: '0 0 10px', wordBreak: 'break-all' }}>{APP_URL}</p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <button
              onClick={async () => {
                try {
                  const blob = await generateShareImage();
                  if (blob && navigator.canShare) {
                    const file = new File([blob], 'vividaqua.png', { type: 'image/png' });
                    if (navigator.canShare({ files: [file] })) {
                      await navigator.share({ title: 'VividAqua', text: 'Order air galon sekarang! ' + APP_URL, files: [file] });
                      return;
                    }
                  }
                  if (navigator.share) {
                    await navigator.share({ title: 'VividAqua Customer App', url: APP_URL });
                  } else {
                    await navigator.clipboard.writeText(APP_URL);
                    toast.success(t('home.linkCopied'));
                  }
                } catch { }
              }}
              style={{ padding: '10px', background: C.primary, color: 'white', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer' }}
            >
              {t('home.share')}
            </button>
            <button
              onClick={async () => { await navigator.clipboard.writeText(APP_URL); toast.success(t('home.linkCopied')); }}
              style={{ padding: '10px', background: C.primaryBg, color: C.primary, border: `1px solid ${C.primaryBorder}`, borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer' }}
            >
              {t('home.copyLink')}
            </button>
          </div>
        </div>

      </div>
      <BottomNavV0 customer={customer} />
    </div>
  );
}
