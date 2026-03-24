// src/Pages/OrderDelivery.tsx
import React, { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import { useLanguage } from '../contexts/LanguageContext';
import { useColorTokens } from '../contexts/ColorTokensContext';
import { theme } from '../theme';
import { Order, OrderItem } from '../Types';
import './OrderDelivery.css';

export const OrderDelivery: React.FC = () => {
  const navigate = useNavigate();
  const { orderId } = useParams<{ orderId: string }>();
  const { t, language } = useLanguage();
  const { tokens, isDark } = useColorTokens();

  const [order, setOrder] = useState<Order | null>(null);
  const [orderItems, setOrderItems] = useState<OrderItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    fetchOrderDetails();
  }, [orderId]);

  const fetchOrderDetails = async () => {
    try {
      setLoading(true);
      const token = sessionStorage.getItem('auth_token');
      if (!token) throw new Error('Session expired, please login again');
      const { data, error } = await supabase.functions.invoke('get-orders', {
        body: { token, order_id: orderId },
      });
      if (error) throw new Error(error.message);
      if (!data?.success) throw new Error(data?.error || 'Order not found');
      setOrder(data.order);
      setOrderItems(data.order?.order_items || []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleConfirmDelivery = async () => {
    try {
      setConfirming(true);
      const { error } = await supabase
        .from('orders')
        .update({
          status: 'delivered',
          delivered_date: new Date().toISOString().split('T')[0],
        })
        .eq('id', orderId);
      if (error) throw error;
      alert(t('delivery.confirmSuccess'));
      await fetchOrderDetails();
    } catch (err: any) {
      alert(`${t('delivery.confirmFailed')}: ${err.message}`);
    } finally {
      setConfirming(false);
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return new Intl.DateTimeFormat(language === 'en' ? 'en-US' : 'id-ID', {
      year: 'numeric', month: 'long', day: 'numeric', weekday: 'long',
    }).format(date);
  };

  const formatCurrency = (amount: number) =>
    new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(amount);

  const calculateItemTotal = (item: OrderItem) => item.unit_price * item.quantity;

  // ── Shared styles ──────────────────────────────────────────────
  const cardStyle: React.CSSProperties = {
    background: tokens.card,
    borderRadius: '16px',
    padding: '20px',
    boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
    backdropFilter: tokens.cardBlur,
    WebkitBackdropFilter: tokens.cardBlur,
    border: `1px solid ${tokens.primaryBorder}`,
  };

  const sectionTitle: React.CSSProperties = {
    margin: '0 0 14px 0', fontSize: '15px', fontWeight: 700, color: tokens.text,
  };

  const infoRowStyle: React.CSSProperties = {
    display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
    padding: '8px 0', borderBottom: `1px solid ${tokens.divider}`,
  };

  const labelStyle: React.CSSProperties = { color: tokens.muted, fontSize: '13px', flexShrink: 0, marginRight: '12px' };
  const valueStyle: React.CSSProperties = { color: tokens.text, fontWeight: 500, fontSize: '13px', textAlign: 'right' };

  // ── Status badge ───────────────────────────────────────────────
  const getStatusBadge = (status: string) => {
    const map: Record<string, { label: string; bg: string; color: string; border: string }> = {
      pending:   { label: t('home.statusPending'),    bg: tokens.primaryBg,                                    color: tokens.primary,                             border: tokens.primaryBorder },
      scheduled: { label: t('home.statusScheduled'),  bg: isDark ? 'rgba(0,180,216,0.15)' : '#dbeafe',        color: isDark ? '#38bdf8' : '#1e40af',             border: isDark ? 'rgba(0,180,216,0.3)' : '#93c5fd' },
      delivered: { label: t('orders.statusDelivered'),bg: isDark ? 'rgba(34,197,94,0.15)' : '#d1fae5',        color: isDark ? '#4ade80' : '#065f46',             border: isDark ? 'rgba(34,197,94,0.3)' : '#6ee7b7' },
      cancelled: { label: t('orders.statusCancelled'),bg: isDark ? 'rgba(239,68,68,0.15)' : '#fee2e2',        color: isDark ? '#f87171' : '#991b1b',             border: isDark ? 'rgba(239,68,68,0.3)' : '#fca5a5' },
    };
    const s = map[status] || { label: status.toUpperCase(), bg: tokens.primaryBg, color: tokens.primary, border: tokens.primaryBorder };
    return (
      <span style={{ padding: '4px 12px', borderRadius: '20px', fontSize: '12px', fontWeight: 700, background: s.bg, color: s.color, border: `1px solid ${s.border}` }}>
        {s.label}
      </span>
    );
  };

  const getPaymentBadge = (status: string) => {
    const isPaid = status === 'paid';
    return (
      <span style={{
        padding: '4px 12px', borderRadius: '20px', fontSize: '12px', fontWeight: 700,
        background: isPaid ? (isDark ? 'rgba(34,197,94,0.15)' : '#d1fae5') : (isDark ? 'rgba(239,68,68,0.15)' : '#fee2e2'),
        color: isPaid ? (isDark ? '#4ade80' : '#065f46') : (isDark ? '#f87171' : '#991b1b'),
        border: `1px solid ${isPaid ? (isDark ? 'rgba(34,197,94,0.3)' : '#6ee7b7') : (isDark ? 'rgba(239,68,68,0.3)' : '#fca5a5')}`,
      }}>
        {isPaid ? `✅ ${t('status.paid')}` : `⏳ ${t('status.unpaid')}`}
      </span>
    );
  };

  // ── Progress step helpers ───────────────────────────────────────
  const stepIcon = (isActive: boolean, isCompleted: boolean): React.CSSProperties => ({
    width: '44px', height: '44px', borderRadius: '50%', display: 'flex', alignItems: 'center',
    justifyContent: 'center', fontSize: '18px', transition: 'all 0.3s',
    background: isActive ? tokens.gradientPrimary : (isDark ? 'rgba(255,255,255,0.08)' : '#e5e7eb'),
    transform: isActive ? 'scale(1.1)' : 'scale(1)',
    boxShadow: isActive ? `0 4px 12px ${tokens.primaryBorder}` : 'none',
    animation: isCompleted ? 'od-pulse 2s ease-in-out infinite' : 'none',
  });

  const stepLabel = (isActive: boolean): React.CSSProperties => ({
    fontSize: '11px', fontWeight: isActive ? 700 : 400,
    color: isActive ? tokens.primary : tokens.muted, textAlign: 'center',
  });

  const progressLine = (isActive: boolean): React.CSSProperties => ({
    flex: 1, height: '3px', margin: '0 6px', marginBottom: '18px',
    background: isActive ? tokens.primary : (isDark ? 'rgba(255,255,255,0.08)' : '#e5e7eb'),
    transition: 'background 0.3s',
  });

  // ── Loading ─────────────────────────────────────────────────────
  if (loading) {
    return (
      <div style={{ minHeight: '100vh', background: tokens.pageBg, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
        <div style={{ ...cardStyle, padding: '40px', textAlign: 'center', maxWidth: '400px', width: '100%' }}>
          <div className="od-spinner" style={{ borderTopColor: tokens.primary }} />
          <p style={{ color: tokens.muted, marginTop: '16px' }}>{t('delivery.loadingOrder')}</p>
        </div>
      </div>
    );
  }

  // ── Error ────────────────────────────────────────────────────────
  if (error || !order) {
    return (
      <div style={{ minHeight: '100vh', background: tokens.pageBg, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
        <div style={{ ...cardStyle, padding: '40px', textAlign: 'center', maxWidth: '400px', width: '100%' }}>
          <p style={{ fontSize: '48px', margin: '0 0 16px' }}>❌</p>
          <h2 style={{ color: tokens.text, margin: '0 0 8px' }}>{t('delivery.loadFailed')}</h2>
          <p style={{ color: tokens.muted, marginBottom: '20px' }}>{error || t('delivery.orderNotFound')}</p>
          <button
            onClick={() => navigate('/orders')}
            style={{ padding: '12px 24px', background: tokens.gradientPrimary, color: 'white', border: 'none', borderRadius: '8px', fontWeight: 600, cursor: 'pointer' }}
          >
            {t('delivery.returnToList')}
          </button>
        </div>
      </div>
    );
  }

  const isConfirmed = ['scheduled', 'delivered'].includes(order.status);
  const isDelivered = order.status === 'delivered';
  const isScheduled = order.status === 'scheduled';

  return (
    <div style={{ minHeight: '100vh', background: tokens.pageBg, padding: '20px', paddingBottom: '80px' }}>
      <div style={{ maxWidth: '600px', margin: '0 auto' }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '24px', background: 'rgba(0,0,0,0.30)', borderRadius: '16px', padding: '12px 16px', backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)' }}>
          <button
            onClick={() => navigate(-1)}
            style={{ background: 'rgba(255,255,255,0.15)', color: 'white', border: '1px solid rgba(255,255,255,0.3)', padding: '8px 16px', borderRadius: '8px', cursor: 'pointer', fontSize: '14px', fontWeight: 600 }}
          >
            ← {t('common.back')}
          </button>
          <h1 style={{ color: 'white', fontSize: '22px', margin: 0, fontWeight: 700, textShadow: '0 1px 4px rgba(0,0,0,0.4)' }}>{t('delivery.title')}</h1>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>

          {/* ── Status Card ── */}
          <div style={cardStyle}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap', gap: '8px' }}>
              <p style={{ ...sectionTitle, marginBottom: 0 }}>{t('delivery.orderStatus')}</p>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                {getStatusBadge(order.status)}
                {getPaymentBadge(order.payment_status)}
              </div>
            </div>

            {/* Progress bar */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px' }}>
                <div style={stepIcon(true, false)}>📋</div>
                <span style={stepLabel(true)}>{t('progress.confirmed')}</span>
              </div>
              <div style={progressLine(isConfirmed)} />
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px' }}>
                <div style={stepIcon(isScheduled || isDelivered, isDelivered)}>🚚</div>
                <span style={stepLabel(isScheduled || isDelivered)}>{t('progress.delivering')}</span>
              </div>
              <div style={progressLine(isDelivered)} />
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px' }}>
                <div style={stepIcon(isDelivered, false)}>✅</div>
                <span style={stepLabel(isDelivered)}>{t('progress.delivered')}</span>
              </div>
            </div>
          </div>

          {/* ── Delivery Info Card ── */}
          <div style={cardStyle}>
            <p style={sectionTitle}>📍 {t('delivery.deliveryInfo')}</p>
            {[
              { label: t('delivery.customerName'), value: order.customer_name },
              { label: t('delivery.deliveryAddress'), value: order.customer_address },
              { label: t('delivery.contactPhone'), value: order.customer_whatsapp },
              { label: t('delivery.deliveryDate'), value: formatDate(order.delivery_date) },
              ...(order.delivered_date ? [{ label: t('delivery.actualDelivery'), value: formatDate(order.delivered_date) }] : []),
              ...(order.delivery_notes ? [{ label: t('delivery.deliveryNotes'), value: order.delivery_notes }] : []),
            ].map((row, i, arr) => (
              <div key={i} style={{ ...infoRowStyle, borderBottom: i < arr.length - 1 ? `1px solid ${tokens.divider}` : 'none' }}>
                <span style={labelStyle}>{row.label}</span>
                <span style={valueStyle}>{row.value}</span>
              </div>
            ))}
          </div>

          {/* ── Order Items Card ── */}
          <div style={cardStyle}>
            <p style={sectionTitle}>📦 {t('delivery.orderDetails')}</p>
            {orderItems.map((item, i) => (
              <div key={item.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: i < orderItems.length - 1 ? `1px solid ${tokens.divider}` : 'none' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flex: 1 }}>
                  <span style={{ fontWeight: 600, fontSize: '13px', color: tokens.text }}>{item.product}</span>
                  {item.is_refill && (
                    <span style={{ background: tokens.primaryBg, color: tokens.primary, border: `1px solid ${tokens.primaryBorder}`, padding: '1px 6px', borderRadius: '10px', fontSize: '10px', fontWeight: 700 }}>
                      {t('delivery.refill')}
                    </span>
                  )}
                  <span style={{ color: tokens.muted, fontSize: '13px' }}>× {item.quantity}</span>
                </div>
                <span style={{ fontWeight: 700, fontSize: '13px', color: tokens.text, whiteSpace: 'nowrap' }}>{formatCurrency(calculateItemTotal(item))}</span>
              </div>
            ))}

            {(order.empty_gallons_returned > 0 || order.borrowed_gallons > 0) && (
              <div style={{ marginTop: '12px', padding: '12px', background: tokens.primaryBg, borderRadius: '10px', border: `1px solid ${tokens.primaryBorder}` }}>
                {order.empty_gallons_returned > 0 && (
                  <div style={{ ...infoRowStyle, borderBottom: order.borrowed_gallons > 0 ? `1px solid ${tokens.divider}` : 'none' }}>
                    <span style={labelStyle}>🔄 {t('delivery.emptyGallons')}</span>
                    <span style={valueStyle}>{order.empty_gallons_returned} {language === 'en' ? 'pcs' : 'buah'}</span>
                  </div>
                )}
                {order.borrowed_gallons > 0 && (
                  <div style={{ ...infoRowStyle, borderBottom: 'none' }}>
                    <span style={labelStyle}>📦 {t('delivery.borrowedGallons')}</span>
                    <span style={valueStyle}>{order.borrowed_gallons} {language === 'en' ? 'pcs' : 'buah'}</span>
                  </div>
                )}
              </div>
            )}

            <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: `2px solid ${tokens.divider}` }}>
              {order.customer_discount > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: '13px' }}>
                  <span style={{ color: tokens.muted }}>{t('delivery.customerDiscount')}</span>
                  <span style={{ color: theme.success, fontWeight: 600 }}>-{formatCurrency(order.customer_discount)}</span>
                </div>
              )}
              <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: '8px', fontSize: '16px', fontWeight: 700 }}>
                <span style={{ color: tokens.text }}>{t('delivery.orderTotal')}</span>
                <span style={{ color: tokens.primary }}>{formatCurrency(order.total_amount)}</span>
              </div>
            </div>
          </div>

          {/* ── Confirm Receipt Card (scheduled only) ── */}
          {isScheduled && (
            <div style={cardStyle}>
              <p style={sectionTitle}>📦 {t('delivery.confirmReceipt')}</p>
              <p style={{ color: tokens.muted, fontSize: '13px', textAlign: 'center', marginBottom: '16px' }}>
                {t('delivery.pleaseConfirm')}
              </p>
              <button
                onClick={() => { if (window.confirm(t('delivery.confirmMessage'))) handleConfirmDelivery(); }}
                disabled={confirming}
                style={{
                  width: '100%', padding: '14px', background: confirming ? (isDark ? 'rgba(255,255,255,0.1)' : '#ccc') : tokens.gradientPrimary,
                  color: 'white', border: 'none', borderRadius: '12px', fontSize: '15px', fontWeight: 700,
                  cursor: confirming ? 'not-allowed' : 'pointer', marginBottom: '12px',
                }}
              >
                {confirming ? t('delivery.confirming') : `✅ ${t('delivery.confirmButton')}`}
              </button>
              <div style={{ background: tokens.primaryBg, borderRadius: '10px', padding: '12px', border: `1px solid ${tokens.primaryBorder}` }}>
                <p style={{ margin: '0 0 4px', fontSize: '12px', color: tokens.muted }}>💡 {t('delivery.tips')}</p>
                <p style={{ margin: 0, fontSize: '12px', color: tokens.muted }}>❓ {t('delivery.contact')}</p>
              </div>
            </div>
          )}

          {/* ── Delivery Evidence ── */}
          {order.delivery_evidence && (
            <div style={cardStyle}>
              <p style={sectionTitle}>📸 {t('delivery.deliveryEvidence')}</p>
              <div style={{ borderRadius: '10px', overflow: 'hidden', marginTop: '4px' }}>
                <img src={order.delivery_evidence} alt={t('delivery.deliveryEvidence')} style={{ width: '100%', height: 'auto', display: 'block' }} />
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
};

export default OrderDelivery;
