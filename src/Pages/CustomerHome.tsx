// src/Pages/CustomerHome.tsx - CORRECTED VERSION
// Fixed: customer_type checks, sessionStorage, logout navigation

import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { QRCodeCanvas } from 'qrcode.react';
import { supabase } from '../supabaseClient';
import BottomNav from '../Components/BottomNav';
import { theme } from '../theme';
import { formatCurrency } from '../utils/format';
import { useLanguage } from '../contexts/LanguageContext';

const APP_URL = 'https://vividaqua.online/';

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

export default function CustomerHome({ customer }: CustomerHomeProps) {
  const navigate = useNavigate();
  const { t } = useLanguage();
  const [loading, setLoading] = useState(false);
  const [pendingOrders, setPendingOrders] = useState<Order[]>([]);
  const [productVouchers, setProductVouchers] = useState<ProductVoucherRow[]>([]);
  const [unpaidAmount, setUnpaidAmount] = useState(0);
  const [lastDeliveryDate, setLastDeliveryDate] = useState<string | null>(null);
  const [paymentTerm, setPaymentTerm] = useState<string>('');
  const qrRef = useRef<HTMLCanvasElement>(null);
  const canOrder = customer.branch && customer.branch !== 'Pending';

  const generateShareImage = async (): Promise<Blob | null> => {
    const qrCanvas = qrRef.current;
    if (!qrCanvas) return null;

    const W = 540;
    const H = 780;
    const offscreen = document.createElement('canvas');
    offscreen.width = W;
    offscreen.height = H;
    const ctx = offscreen.getContext('2d');
    if (!ctx) return null;

    // Background gradient
    const bg = ctx.createLinearGradient(0, 0, W, H);
    bg.addColorStop(0, '#4f46e5');
    bg.addColorStop(0.55, '#7c3aed');
    bg.addColorStop(1, '#a21caf');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    // Decorative circles
    ctx.save();
    ctx.globalAlpha = 0.13;
    ctx.fillStyle = 'white';
    ctx.beginPath(); ctx.arc(W * 0.92, -10, 180, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(-20, H * 0.35, 110, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(W * 0.8, H * 0.88, 70, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(W * 0.15, H * 0.85, 45, 0, Math.PI * 2); ctx.fill();
    ctx.restore();

    // Top wave shape
    ctx.save();
    ctx.globalAlpha = 0.08;
    ctx.fillStyle = 'white';
    ctx.beginPath();
    ctx.moveTo(0, 220);
    ctx.quadraticCurveTo(W * 0.25, 200, W * 0.5, 225);
    ctx.quadraticCurveTo(W * 0.75, 250, W, 210);
    ctx.lineTo(W, 0); ctx.lineTo(0, 0);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // Logo
    try {
      const logo = await loadImage(`${import.meta.env.BASE_URL}logo.png`);
      const logoH = 58;
      const logoW = (logo.width / logo.height) * logoH;
      ctx.drawImage(logo, (W - logoW) / 2, 46, logoW, logoH);
    } catch { /* fallback: draw emoji */ }

    // Brand name
    ctx.fillStyle = 'white';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.font = 'bold 42px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    ctx.fillText('VividAqua', W / 2, 164);

    // Tagline
    ctx.globalAlpha = 0.8;
    ctx.font = '16px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    ctx.fillText('💧 Premium Water Delivery Service', W / 2, 196);
    ctx.globalAlpha = 1;

    // White card with shadow
    const cardX = 44;
    const cardY = 228;
    const cardW = W - 88;
    const cardH = 352;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.3)';
    ctx.shadowBlur = 32;
    ctx.shadowOffsetY = 10;
    ctx.fillStyle = 'white';
    drawRoundRect(ctx, cardX, cardY, cardW, cardH, 24);
    ctx.fill();
    ctx.restore();

    // Light gradient shimmer on card top
    ctx.save();
    const shimmer = ctx.createLinearGradient(cardX, cardY, cardX, cardY + 80);
    shimmer.addColorStop(0, 'rgba(255,255,255,0.6)');
    shimmer.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = shimmer;
    drawRoundRect(ctx, cardX, cardY, cardW, 80, 24);
    ctx.fill();
    ctx.restore();

    // "Scan to Order" label inside card (top)
    ctx.fillStyle = '#7c3aed';
    ctx.font = 'bold 13px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText('📲  SCAN TO ORDER', W / 2, cardY + 30);

    // QR code
    const qrSize = 216;
    const qrX = (W - qrSize) / 2;
    const qrY = cardY + 46;
    // Subtle border around QR
    ctx.save();
    ctx.strokeStyle = '#e5e7eb';
    ctx.lineWidth = 1.5;
    drawRoundRect(ctx, qrX - 10, qrY - 10, qrSize + 20, qrSize + 20, 12);
    ctx.stroke();
    ctx.fillStyle = '#fafafa';
    ctx.fill();
    ctx.restore();
    ctx.drawImage(qrCanvas, qrX, qrY, qrSize, qrSize);

    // URL pill below QR
    const urlText = APP_URL;
    const pillW = 280;
    const pillH = 28;
    const pillX = (W - pillW) / 2;
    const pillY = qrY + qrSize + 18;
    ctx.fillStyle = '#f3f4f6';
    drawRoundRect(ctx, pillX, pillY, pillW, pillH, 14);
    ctx.fill();
    ctx.fillStyle = '#6b7280';
    ctx.font = '12px "SF Mono", "Fira Code", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(urlText, W / 2, pillY + 14);

    // Card bottom text
    ctx.fillStyle = '#4f46e5';
    ctx.font = 'bold 14px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText('Order air galon sekarang!', W / 2, cardY + cardH - 22);

    // Bottom section
    // Divider
    ctx.strokeStyle = 'rgba(255,255,255,0.2)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(80, cardY + cardH + 44);
    ctx.lineTo(W - 80, cardY + cardH + 44);
    ctx.stroke();

    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.font = 'bold 17px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText('Air galon bersih & berkualitas', W / 2, cardY + cardH + 78);

    ctx.fillStyle = 'rgba(255,255,255,0.65)';
    ctx.font = '14px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    ctx.fillText('Pengiriman cepat ke rumah Anda ✨', W / 2, cardY + cardH + 106);

    // Bottom badge
    const badgeW = 210;
    const badgeH = 36;
    const badgeX = (W - badgeW) / 2;
    const badgeY = H - 50;
    ctx.fillStyle = 'rgba(255,255,255,0.15)';
    drawRoundRect(ctx, badgeX, badgeY, badgeW, badgeH, 18);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.3)';
    ctx.lineWidth = 1;
    drawRoundRect(ctx, badgeX, badgeY, badgeW, badgeH, 18);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.font = '600 13px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillText('🌐  vividaqua.online', W / 2, badgeY + 18);

    return new Promise(resolve => offscreen.toBlob(resolve, 'image/png'));
  };

  useEffect(() => {
    loadHomeData();
    if (customer.customer_type === 'pre_pay') loadProductVouchers();
  }, [customer.id]);

  const loadHomeData = async () => {
    try {
      const token = sessionStorage.getItem('auth_token');
      if (!token) return;
      const { data, error } = await supabase.functions.invoke('get-home-data', {
        body: { token },
      });
      if (error || !data?.success) return;
      setPendingOrders(data.pending_orders || []);
      setLastDeliveryDate(data.last_delivery_date ?? null);
      setUnpaidAmount(data.unpaid_amount ?? 0);
      setPaymentTerm(data.payment_term || 'daily');
    } catch {
      // silently fail — UI shows defaults
    }
  };

  const loadProductVouchers = async () => {
    try {
      const { data } = await supabase
        .from('customer_product_vouchers')
        .select('product_id, balance, products(name)')
        .eq('customer_id', customer.id);
      setProductVouchers((data as ProductVoucherRow[]) || []);
    } catch {
      // silently fail
    }
  };

  const handleDeleteOrder = async (orderId: string) => {
    if (!confirm(t('home.deleteConfirm'))) return;

    try {
      const { error: itemsError } = await supabase
        .from('order_items')
        .delete()
        .eq('order_id', orderId);

      if (itemsError) throw itemsError;

      const { error: orderError } = await supabase
        .from('orders')
        .delete()
        .eq('id', orderId);

      if (orderError) throw orderError;

      toast.success(t('home.deleteSuccess'));
      loadHomeData();
    } catch (err: any) {
      console.error('Error deleting order:', err);
      toast.error(t('home.deleteFailed') + err.message);
    }
  };

  const handleSignOut = () => {
    setLoading(true);
    sessionStorage.removeItem('customer');
    sessionStorage.removeItem('auth_token');
    sessionStorage.removeItem('authenticated');
    window.dispatchEvent(new Event('session-auth-updated'));
    navigate('/', { replace: true });
  };

  const formatDate = (dateString: string): string => {
    return new Date(dateString).toLocaleDateString('id-ID', {
      timeZone: 'Asia/Jakarta',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  const getStatusColor = (status: string): string => {
    switch (status) {
      case 'pending':
        return theme.warning;
      case 'scheduled':
        return theme.info;
      default:
        return '#999';
    }
  };

  const getStatusIcon = (status: string): string => {
    switch (status) {
      case 'pending':
        return '⏳';
      case 'scheduled':
        return '📅';
      default:
        return '📦';
    }
  };

  return (
    <div style={{
      minHeight: '100vh',
      background: theme.gradientPrimary,
      padding: '20px',
      paddingBottom: '80px',
    }}>
      {/* Navigation Bar */}
      <div style={{
        maxWidth: '1200px',
        margin: '0 auto 20px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center'
      }}>
        <img src={`${import.meta.env.BASE_URL}logo.png`} alt="Water Delivery" style={{ height: '36px', objectFit: 'contain' }} />
        <button
          onClick={handleSignOut}
          disabled={loading}
          style={{
            padding: '10px 20px',
            background: 'rgba(255,255,255,0.2)',
            color: 'white',
            border: '2px solid white',
            borderRadius: '8px',
            fontSize: '14px',
            fontWeight: 'bold',
            cursor: loading ? 'not-allowed' : 'pointer'
          }}
        >
          {loading ? '...' : t('home.signOut')}
        </button>
      </div>

      {/* Main Content */}
      <div style={{
        maxWidth: '800px',
        margin: '0 auto'
      }}>
        {/* Customer Card */}
        <div style={{
          background: 'white',
          borderRadius: '20px',
          padding: '24px',
          marginBottom: '20px',
          boxShadow: '0 10px 40px rgba(0,0,0,0.2)'
        }}>
          <div style={{ marginBottom: '20px' }}>
            <h2 style={{ fontSize: '20px', margin: '0 0 4px 0', fontWeight: '600' }}>
              {customer.name}
            </h2>
            <p style={{ fontSize: '13px', color: theme.textMuted, margin: 0 }}>
              {customer.customer_type === 'pre_pay' ? t('home.prepaid') : t('home.postpaid')}
            </p>
          </div>

          {/* Voucher Balance - pre_pay: per-product breakdown */}
          {customer.customer_type === 'pre_pay' && (
            <div style={{ marginBottom: '20px' }}>
              <div style={{ background: theme.gradientPrimary, padding: '16px 20px', borderRadius: '12px', color: 'white' }}>
                <p style={{ fontSize: '12px', margin: '0 0 12px 0', opacity: 0.9, fontWeight: '600' }}>
                  🎫 {t('home.voucherBalance')}
                </p>
                {productVouchers.length === 0 ? (
                  <p style={{ fontSize: '14px', margin: 0, opacity: 0.85 }}>{t('home.noVouchers')}</p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {productVouchers.map(row => (
                      <div key={row.product_id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontSize: '13px', opacity: 0.9 }}>{row.products?.name ?? '—'}</span>
                        <span style={{ fontSize: '20px', fontWeight: 'bold' }}>{row.balance}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Pending Orders Section */}
          {pendingOrders.length > 0 && (
            <div style={{ marginBottom: '20px' }}>
              <h3 style={{ fontSize: '18px', marginBottom: '15px', color: theme.primary }}>
                📋 {t('home.pendingOrders')}
              </h3>
              {pendingOrders.map((order) => (
                <div
                  key={order.id}
                  style={{
                    background: '#f8f9fa',
                    borderRadius: '12px',
                    padding: '20px',
                    marginBottom: '15px',
                    border: `2px solid ${getStatusColor(order.status)}`
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: '15px' }}>
                    <div>
                      <p style={{
                        display: 'inline-block',
                        background: getStatusColor(order.status),
                        color: 'white',
                        padding: '4px 12px',
                        borderRadius: '20px',
                        fontSize: '12px',
                        fontWeight: 'bold',
                        margin: '0 0 10px 0'
                      }}>
                        {getStatusIcon(order.status)} {order.status.toUpperCase()}
                      </p>
                      <p style={{ fontSize: '14px', color: '#666', margin: '5px 0' }}>
                        🗓️ {t('home.delivery')} <strong>{formatDate(order.delivery_date)}</strong>
                      </p>
                        <p style={{ fontSize: '16px', color: theme.success, fontWeight: 'bold', margin: '5px 0' }}>
                        💰 {formatCurrency(order.total_amount)}
                      </p>
                    </div>
                  </div>

                  {/* Action Buttons - Only for pending orders */}
                  {order.status === 'pending' && (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                      <button
                        onClick={() => navigate(`/place-order?edit=${order.id}`)}
                        style={{
                          padding: '10px',
                          background: theme.info,
                          color: 'white',
                          border: 'none',
                          borderRadius: '8px',
                          fontSize: '14px',
                          fontWeight: 'bold',
                          cursor: 'pointer'
                        }}
                      >
                        {t('home.edit')}
                      </button>
                      <button
                        onClick={() => handleDeleteOrder(order.id)}
                        style={{
                          padding: '10px',
                          background: theme.error,
                          color: 'white',
                          border: 'none',
                          borderRadius: '8px',
                          fontSize: '14px',
                          fontWeight: 'bold',
                          cursor: 'pointer'
                        }}
                      >
                        {t('home.delete')}
                      </button>
                    </div>
                  )}

                  {/* Scheduled message */}
                  {order.status === 'scheduled' && (
                    <div style={{
                      background: '#e3f2fd',
                      padding: '10px',
                      borderRadius: '8px',
                      fontSize: '13px',
                      color: '#1976d2',
                      textAlign: 'center'
                    }}>
                      ℹ️ {t('home.scheduledMsg')}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Action Buttons - pre_pay (matches water depot schema) */}
          {customer.customer_type === 'pre_pay' ? (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
              <button
                onClick={() => navigate('/place-order')}
                disabled={!canOrder}
                style={{
                  padding: '14px',
                  background: canOrder ? 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' : '#ccc',
                  color: 'white',
                  border: 'none',
                  borderRadius: '8px',
                  fontSize: '16px',
                  fontWeight: 'bold',
                  cursor: canOrder ? 'pointer' : 'not-allowed'
                }}
              >
                🛒 {t('home.orderDelivery')}
              </button>
              <button
                onClick={() => navigate('/buy-vouchers')}
                style={{
                  padding: '14px',
                  background: theme.gradientSuccess,
                  color: 'white',
                  border: 'none',
                  borderRadius: '8px',
                  fontSize: '16px',
                  fontWeight: 'bold',
                  cursor: 'pointer'
                }}
              >
                🎫 {t('home.buyVouchers')}
              </button>
            </div>
          ) : (
            <button
              onClick={() => navigate('/place-order')}
              disabled={!canOrder}
              style={{
                width: '100%',
                padding: '14px',
                background: canOrder ? 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' : '#ccc',
                color: 'white',
                border: 'none',
                borderRadius: '8px',
                fontSize: '16px',
                fontWeight: 'bold',
                cursor: canOrder ? 'pointer' : 'not-allowed'
              }}
            >
              🛒 {t('home.orderDelivery')}
            </button>
          )}
        </div>

        {/* Quick Info */}
        <div style={{
          background: 'white',
          borderRadius: '20px',
          padding: '24px',
          boxShadow: '0 10px 40px rgba(0,0,0,0.2)'
        }}>
          <h3 style={{ fontSize: '18px', margin: '0 0 16px 0', fontWeight: '600' }}>📊 {t('home.quickInfo')}</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>

            {/* Account Status */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 14px', background: '#f8f9fa', borderRadius: '10px' }}>
              <span style={{ fontSize: '13px', color: '#666' }}>{t('home.accountStatus')}</span>
              <span style={{ fontSize: '13px', fontWeight: '600', color: canOrder ? theme.success : theme.warning }}>
                {canOrder ? `✅ ${t('home.active')}` : `⏳ ${t('home.pendingSetup')}`}
              </span>
            </div>

            {/* Service Branch */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 14px', background: '#f8f9fa', borderRadius: '10px' }}>
              <span style={{ fontSize: '13px', color: '#666' }}>{t('home.serviceBranch')}</span>
              <span style={{ fontSize: '13px', fontWeight: '600', color: theme.text }}>
                {customer.branch === 'Pending' || !customer.branch ? '—' : customer.branch}
              </span>
            </div>

            {/* Billing Cycle */}
            {paymentTerm && (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 14px', background: '#f8f9fa', borderRadius: '10px' }}>
                <span style={{ fontSize: '13px', color: '#666' }}>{t('home.billingCycle')}</span>
                <span style={{ fontSize: '13px', fontWeight: '600', color: theme.text }}>
                  {{ daily: 'Daily', weekly: 'Weekly', biweekly: 'Biweekly', monthly: 'Monthly' }[paymentTerm] ?? paymentTerm}
                </span>
              </div>
            )}

            {/* On Delivery (scheduled) */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 14px', background: '#f8f9fa', borderRadius: '10px' }}>
              <span style={{ fontSize: '13px', color: '#666' }}>{t('home.onDelivery')}</span>
              <span style={{ fontSize: '13px', fontWeight: '600', color: theme.info }}>
                {pendingOrders.filter(o => o.status === 'scheduled').length} order(s)
              </span>
            </div>

            {/* Unpaid Amount — later_pay only */}
            {customer.customer_type !== 'pre_pay' && (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 14px', background: unpaidAmount > 0 ? '#fff3e0' : '#f8f9fa', borderRadius: '10px', border: unpaidAmount > 0 ? '1px solid #ffb74d' : 'none' }}>
                <div>
                  <span style={{ fontSize: '13px', color: '#666' }}>{t('home.unpaidAmount')}</span>
                  <div style={{ fontSize: '13px', fontWeight: '700', color: unpaidAmount > 0 ? theme.error : theme.success }}>
                    {unpaidAmount > 0 ? formatCurrency(unpaidAmount) : `✅ ${t('home.allPaid')}`}
                  </div>
                </div>
                {unpaidAmount > 0 && (
                  <button
                    onClick={() => navigate('/orders')}
                    style={{ padding: '8px 14px', background: theme.error, color: 'white', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: 'bold', cursor: 'pointer', whiteSpace: 'nowrap' }}
                  >
                    {`${t('home.payNow')} →`}
                  </button>
                )}
              </div>
            )}

            {/* Last Delivery */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 14px', background: '#f8f9fa', borderRadius: '10px' }}>
              <span style={{ fontSize: '13px', color: '#666' }}>{t('home.lastDelivery')}</span>
              <span style={{ fontSize: '13px', fontWeight: '600', color: theme.text }}>
                {lastDeliveryDate ? formatDate(lastDeliveryDate) : '—'}
              </span>
            </div>

          </div>
        </div>

        {/* Share App Card */}
        <div style={{ background: 'white', borderRadius: '20px', padding: '24px', marginTop: '20px', boxShadow: '0 10px 40px rgba(0,0,0,0.2)', textAlign: 'center' }}>
          <h3 style={{ fontSize: '16px', fontWeight: '600', margin: '0 0 4px 0' }}>{t('home.shareApp')}</h3>
          <p style={{ fontSize: '12px', color: theme.textMuted, margin: '0 0 16px 0' }}>{t('home.scanShare')}</p>

          <div style={{ display: 'inline-block', padding: '12px', background: '#f8f9fa', borderRadius: '12px', marginBottom: '16px' }}>
            <QRCodeCanvas
              ref={qrRef}
              value={APP_URL}
              size={160}
              level="H"
              imageSettings={{
                src: '/shortcut.png',
                height: 36,
                width: 36,
                excavate: true,
              }}
            />
          </div>

          <p style={{ fontSize: '11px', color: theme.textMuted, margin: '0 0 14px 0', wordBreak: 'break-all' }}>{APP_URL}</p>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
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
                } catch {
                  // user cancelled
                }
              }}
              style={{ padding: '10px', background: theme.gradientPrimary, color: 'white', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: 'bold', cursor: 'pointer' }}
            >
              {t('home.share')}
            </button>
            <button
              onClick={async () => {
                await navigator.clipboard.writeText(APP_URL);
                toast.success(t('home.linkCopied'));
              }}
              style={{ padding: '10px', background: 'white', color: theme.primary, border: `2px solid ${theme.primary}`, borderRadius: '8px', fontSize: '13px', fontWeight: 'bold', cursor: 'pointer' }}
            >
              {t('home.copyLink')}
            </button>
          </div>
        </div>

      </div>
      <BottomNav customer={customer} />
    </div>
  );
}
