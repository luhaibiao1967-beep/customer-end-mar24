// src/Pages/OrderDelivery.tsx
import React, { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import { Order, OrderItem } from '../Types';
import './OrderDelivery.css';

export const OrderDelivery: React.FC = () => {
  const navigate = useNavigate();
  const { orderId } = useParams<{ orderId: string }>();
  
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
      
      // 获取订单详情
      const { data: orderData, error: orderError } = await supabase
        .from('orders')
        .select('*')
        .eq('id', orderId)
        .single();

      if (orderError) throw orderError;
      
      // 获取订单项（产品列表）
      const { data: itemsData, error: itemsError } = await supabase
        .from('order_items')
        .select('*')
        .eq('order_id', orderId)
        .order('created_at', { ascending: true });

      if (itemsError) throw itemsError;

      setOrder(orderData);
      setOrderItems(itemsData || []);

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

      alert('配送确认成功！');
      // 重新加载订单数据
      await fetchOrderDetails();

    } catch (err: any) {
      alert(`确认失败: ${err.message}`);
    } finally {
      setConfirming(false);
    }
  };

  const getStatusBadge = (status: string) => {
    const badges: Record<string, { text: string; className: string }> = {
      pending: { text: '待确认', className: 'badge-pending' },
      scheduled: { text: '已安排', className: 'badge-scheduled' },
      delivered: { text: '已送达', className: 'badge-delivered' }
    };
    
    const badge = badges[status] || { text: status, className: 'badge-default' };
    return <span className={`status-badge ${badge.className}`}>{badge.text}</span>;
  };

  const getPaymentBadge = (status: string) => {
    return status === 'paid' 
      ? <span className="payment-badge paid">已付款</span>
      : <span className="payment-badge unpaid">未付款</span>;
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return new Intl.DateTimeFormat('id-ID', {
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
    return (item.unit_price * item.quantity) - item.discount;
  };

  if (loading) {
    return (
      <div className="order-delivery-page">
        <div className="loading-spinner">
          <div className="spinner"></div>
          <p>加载订单信息...</p>
        </div>
      </div>
    );
  }

  if (error || !order) {
    return (
      <div className="order-delivery-page">
        <div className="error-container">
          <h2>❌ 加载失败</h2>
          <p>{error || '订单不存在'}</p>
          <button onClick={() => navigate('/orders')} className="btn-secondary">
            返回订单列表
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="order-delivery-page">
      <header className="page-header">
        <button onClick={() => navigate(-1)} className="btn-back">
          ← 返回
        </button>
        <h1>配送详情</h1>
      </header>

      <div className="delivery-container">
        {/* 订单状态卡片 */}
        <section className="status-card">
          <div className="status-header">
            <h2>订单状态</h2>
            <div className="badges">
              {getStatusBadge(order.status)}
              {getPaymentBadge(order.payment_status)}
            </div>
          </div>
          
          {/* 配送进度条 */}
          <div className="delivery-progress">
            <div className={`progress-step ${['scheduled', 'delivered'].includes(order.status) ? 'active' : ''}`}>
              <div className="step-icon">📋</div>
              <div className="step-label">已确认</div>
            </div>
            <div className={`progress-line ${order.status === 'delivered' ? 'active' : ''}`}></div>
            <div className={`progress-step ${order.status === 'scheduled' ? 'active' : order.status === 'delivered' ? 'active completed' : ''}`}>
              <div className="step-icon">🚚</div>
              <div className="step-label">配送中</div>
            </div>
            <div className={`progress-line ${order.status === 'delivered' ? 'active' : ''}`}></div>
            <div className={`progress-step ${order.status === 'delivered' ? 'active completed' : ''}`}>
              <div className="step-icon">✅</div>
              <div className="step-label">已送达</div>
            </div>
          </div>
        </section>

        {/* 配送信息卡片 */}
        <section className="info-card">
          <h3>📍 配送信息</h3>
          <div className="info-row">
            <span className="info-label">客户姓名</span>
            <span className="info-value">{order.customer_name}</span>
          </div>
          <div className="info-row">
            <span className="info-label">配送地址</span>
            <span className="info-value">{order.customer_address}</span>
          </div>
          <div className="info-row">
            <span className="info-label">联系电话</span>
            <span className="info-value">{order.customer_whatsapp}</span>
          </div>
          <div className="info-row">
            <span className="info-label">配送日期</span>
            <span className="info-value">{formatDate(order.delivery_date)}</span>
          </div>
          {order.delivered_date && (
            <div className="info-row">
              <span className="info-label">实际送达</span>
              <span className="info-value">{formatDate(order.delivered_date)}</span>
            </div>
          )}
          {order.delivery_notes && (
            <div className="info-row">
              <span className="info-label">配送备注</span>
              <span className="info-value">{order.delivery_notes}</span>
            </div>
          )}
        </section>

        {/* 订单详情卡片 */}
        <section className="info-card">
          <h3>📦 订单详情</h3>
          <div className="order-items">
            {orderItems.map((item, index) => (
              <div key={item.id} className="item-row">
                <div className="item-info">
                  <span className="item-name">
                    {item.product}
                    {item.is_refill && <span className="refill-badge">续灌</span>}
                  </span>
                  <span className="item-quantity">× {item.quantity}</span>
                </div>
                <div className="item-pricing">
                  <span className="item-price">{formatCurrency(item.unit_price)}</span>
                  {item.discount > 0 && (
                    <span className="item-discount">-{formatCurrency(item.discount)}</span>
                  )}
                  <span className="item-total">{formatCurrency(calculateItemTotal(item))}</span>
                </div>
              </div>
            ))}
          </div>

          {/* 附加费用信息 */}
          {(order.empty_gallons_returned > 0 || order.borrowed_gallons > 0) && (
            <div className="gallons-info">
              {order.empty_gallons_returned > 0 && (
                <div className="info-row">
                  <span className="info-label">🔄 空桶回收</span>
                  <span className="info-value">{order.empty_gallons_returned} 个</span>
                </div>
              )}
              {order.borrowed_gallons > 0 && (
                <div className="info-row">
                  <span className="info-label">📦 借出桶数</span>
                  <span className="info-value">{order.borrowed_gallons} 个</span>
                </div>
              )}
            </div>
          )}

          {/* 总计 */}
          <div className="order-summary">
            {order.customer_discount > 0 && (
              <div className="summary-row">
                <span>客户折扣</span>
                <span className="discount-amount">-{formatCurrency(order.customer_discount)}</span>
              </div>
            )}
            <div className="summary-row total">
              <span>订单总额</span>
              <span className="total-amount">{formatCurrency(order.total_amount)}</span>
            </div>
          </div>
        </section>

        {/* 配送确认（仅在 scheduled 状态显示） */}
        {order.status === 'scheduled' && (
          <section className="confirm-card">
            <h3>📦 确认收货</h3>
            <p className="confirm-instruction">
              请确认您已收到配送的商品
            </p>
            
            <button
              onClick={() => {
                if (window.confirm('确认已收到配送？此操作不可撤销。')) {
                  handleConfirmDelivery();
                }
              }}
              disabled={confirming}
              className="btn-confirm-simple"
            >
              {confirming ? '确认中...' : '✅ 确认收货'}
            </button>

            <div className="help-text">
              <p>💡 提示：请当面验收商品后再确认</p>
              <p>❓ 如有疑问，请联系客服</p>
            </div>
          </section>
        )}

        {/* 已送达状态 */}
        {order.status === 'delivered' && (
          <section className="success-card">
            <div className="success-icon">✅</div>
            <h3>配送完成</h3>
            <p>感谢您的订单！</p>
            <button onClick={() => navigate('/orders')} className="btn-primary">
              查看更多订单
            </button>
          </section>
        )}

        {/* 配送凭证（如果有） */}
        {order.delivery_evidence && (
          <section className="info-card">
            <h3>📸 配送凭证</h3>
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
