// src/Pages/OrderDelivery.tsx
import React, { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import { useLanguage } from '../contexts/LanguageContext';
import { Order, OrderItem } from '../Types';
import './OrderDelivery.css';

export const OrderDelivery: React.FC = () => {
  const navigate = useNavigate();
  const { orderId } = useParams<{ orderId: string }>();
  const { t, language } = useLanguage();
  
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

      // 更新订单状态为已送达
      const { error } = await supabase
        .from('orders')
        .update({ 
          status: 'delivered',
          delivered_date: new Date().toISOString().split('T')[0] // YYYY-MM-DD 格式
        })
        .eq('id', orderId);

      if (error) throw error;

      alert(t('delivery.confirmSuccess'));
      // 重新加载订单数据
      await fetchOrderDetails();

    } catch (err: any) {
      alert(`${t('delivery.confirmFailed')}: ${err.message}`);
    } finally {
      setConfirming(false);
    }
  };

  const getStatusBadge = (status: string) => {
    const badges: Record<string, { textKey: string; className: string }> = {
      pending: { textKey: 'status.pending', className: 'badge-pending' },
      scheduled: { textKey: 'status.scheduled', className: 'badge-scheduled' },
      delivered: { textKey: 'status.delivered', className: 'badge-delivered' }
    };
    
    const badge = badges[status] || { textKey: status, className: 'badge-default' };
    return <span className={`status-badge ${badge.className}`}>{t(badge.textKey)}</span>;
  };

  const getPaymentBadge = (status: string) => {
    return status === 'paid' 
      ? <span className="payment-badge paid">{t('status.paid')}</span>
      : <span className="payment-badge unpaid">{t('status.unpaid')}</span>;
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return new Intl.DateTimeFormat(language === 'en' ? 'en-US' : 'id-ID', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      weekday: 'long'
    }).format(date);
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('id-ID', {
      style: 'currency',
      currency: 'IDR',
      minimumFractionDigits: 0
    }).format(amount);
  };

  const calculateItemTotal = (item: OrderItem) => {
    return item.unit_price * item.quantity;
  };

  if (loading) {
    return (
      <div className="order-delivery-page">
        <div className="loading-spinner">
          <div className="spinner"></div>
          <p>{t('delivery.loadingOrder')}</p>
        </div>
      </div>
    );
  }

  if (error || !order) {
    return (
      <div className="order-delivery-page">
        <div className="error-container">
          <h2>❌ {t('delivery.loadFailed')}</h2>
          <p>{error || t('delivery.orderNotFound')}</p>
          <button onClick={() => navigate('/orders')} className="btn-secondary">
            {t('delivery.returnToList')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="order-delivery-page">
      <header className="page-header">
        <button onClick={() => navigate(-1)} className="btn-back">
          ← {t('common.back')}
        </button>
        <h1>{t('delivery.title')}</h1>
      </header>

      <div className="delivery-container">
        {/* 订单状态卡片 */}
        <section className="status-card">
          <div className="status-header">
            <h2>{t('delivery.orderStatus')}</h2>
            <div className="badges">
              {getStatusBadge(order.status)}
              {getPaymentBadge(order.payment_status)}
            </div>
          </div>
          
          {/* 配送进度条 */}
          <div className="delivery-progress">
            <div className={`progress-step ${['scheduled', 'delivered'].includes(order.status) ? 'active' : ''}`}>
              <div className="step-icon">📋</div>
              <div className="step-label">{t('progress.confirmed')}</div>
            </div>
            <div className={`progress-line ${order.status === 'delivered' ? 'active' : ''}`}></div>
            <div className={`progress-step ${order.status === 'scheduled' ? 'active' : order.status === 'delivered' ? 'active completed' : ''}`}>
              <div className="step-icon">🚚</div>
              <div className="step-label">{t('progress.delivering')}</div>
            </div>
            <div className={`progress-line ${order.status === 'delivered' ? 'active' : ''}`}></div>
            <div className={`progress-step ${order.status === 'delivered' ? 'active completed' : ''}`}>
              <div className="step-icon">✅</div>
              <div className="step-label">{t('progress.delivered')}</div>
            </div>
          </div>
        </section>

        {/* 配送信息卡片 */}
        <section className="info-card">
          <h3>📍 {t('delivery.deliveryInfo')}</h3>
          <div className="info-row">
            <span className="info-label">{t('delivery.customerName')}</span>
            <span className="info-value">{order.customer_name}</span>
          </div>
          <div className="info-row">
            <span className="info-label">{t('delivery.deliveryAddress')}</span>
            <span className="info-value">{order.customer_address}</span>
          </div>
          <div className="info-row">
            <span className="info-label">{t('delivery.contactPhone')}</span>
            <span className="info-value">{order.customer_whatsapp}</span>
          </div>
          <div className="info-row">
            <span className="info-label">Order Date</span>
            <span className="info-value">{formatDate(order.delivery_date)}</span>
          </div>
          {order.delivered_date && (
            <div className="info-row">
              <span className="info-label">Delivery Date</span>
              <span className="info-value">{formatDate(order.delivered_date)}</span>
            </div>
          )}
          {order.delivery_notes && (
            <div className="info-row">
              <span className="info-label">{t('delivery.deliveryNotes')}</span>
              <span className="info-value">{order.delivery_notes}</span>
            </div>
          )}
        </section>

        {/* 订单详情卡片 */}
        <section className="info-card">
          <h3>📦 {t('delivery.orderDetails')}</h3>
          <div className="order-items">
            {orderItems.map((item) => (
              <div key={item.id} className="item-row">
                <span className="item-name">
                  {item.product}
                  {item.is_refill && <span className="refill-badge">{t('delivery.refill')}</span>}
                  <span className="item-quantity"> × {item.quantity}</span>
                </span>
                <span className="item-total">{formatCurrency(calculateItemTotal(item))}</span>
              </div>
            ))}
          </div>

          {/* 附加费用信息 */}
          {(order.empty_gallons_returned > 0 || order.borrowed_gallons > 0) && (
            <div className="gallons-info">
              {order.empty_gallons_returned > 0 && (
                <div className="info-row">
                  <span className="info-label">🔄 {t('delivery.emptyGallons')}</span>
                  <span className="info-value">{order.empty_gallons_returned} {language === 'en' ? 'pcs' : 'buah'}</span>
                </div>
              )}
              {order.borrowed_gallons > 0 && (
                <div className="info-row">
                  <span className="info-label">📦 {t('delivery.borrowedGallons')}</span>
                  <span className="info-value">{order.borrowed_gallons} {language === 'en' ? 'pcs' : 'buah'}</span>
                </div>
              )}
            </div>
          )}

          {/* 总计 */}
          <div className="order-summary">
            {order.customer_discount > 0 && (
              <div className="summary-row">
                <span>{t('delivery.customerDiscount')}</span>
                <span className="discount-amount">-{formatCurrency(order.customer_discount)}</span>
              </div>
            )}
            <div className="summary-row total">
              <span>{t('delivery.orderTotal')}</span>
              <span className="total-amount">{formatCurrency(order.total_amount)}</span>
            </div>
          </div>
        </section>

        {/* 配送确认（仅在 scheduled 状态显示） */}
        {order.status === 'scheduled' && (
          <section className="confirm-card">
            <h3>📦 {t('delivery.confirmReceipt')}</h3>
            <p className="confirm-instruction">
              {t('delivery.pleaseConfirm')}
            </p>
            
            <button
              onClick={() => {
                if (window.confirm(t('delivery.confirmMessage'))) {
                  handleConfirmDelivery();
                }
              }}
              disabled={confirming}
              className="btn-confirm-simple"
            >
              {confirming ? t('delivery.confirming') : `✅ ${t('delivery.confirmButton')}`}
            </button>

            <div className="help-text">
              <p>💡 {t('delivery.tips')}</p>
              <p>❓ {t('delivery.contact')}</p>
            </div>
          </section>
        )}

        {/* 配送凭证（如果有） */}
        {order.delivery_evidence && (
          <section className="info-card">
            <h3>📸 {t('delivery.deliveryEvidence')}</h3>
            <div className="evidence-image">
              <img src={order.delivery_evidence} alt="配送凭证" />
            </div>
          </section>
        )}
      </div>
    </div>
  );
};

export default OrderDelivery;
