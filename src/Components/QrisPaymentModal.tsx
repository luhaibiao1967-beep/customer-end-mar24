// src/Components/QrisPaymentModal.tsx
// Shows a QRIS QR code and auto-polls every 5s until payment is confirmed

import { useEffect, useRef, useState } from 'react';
import { supabase } from '../supabaseClient';
import { theme } from '../theme';

interface QrisPaymentModalProps {
  qrCodeUrl: string;
  qrString?: string | null;
  midtransOrderId: string;
  amount: number;
  onSuccess: () => void;
  onClose: () => void;
}

const POLL_INTERVAL_MS = 5000;
const MAX_WAIT_MS = 10 * 60 * 1000; // 10 minutes

export default function QrisPaymentModal({
  qrCodeUrl,
  qrString,
  midtransOrderId,
  amount,
  onSuccess,
  onClose,
}: QrisPaymentModalProps) {
  const [secondsLeft, setSecondsLeft] = useState(600); // 10 min countdown
  const [checking, setChecking] = useState(false);
  const [paid, setPaid] = useState(false);
  const [expired, setExpired] = useState(false);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startedAt = useRef(Date.now());

  const formatCurrency = (n: number) =>
    new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(n);

  const checkStatus = async () => {
    if (paid) return;
    const token = sessionStorage.getItem('auth_token');
    if (!token) return;
    setChecking(true);
    try {
      const { data } = await supabase.functions.invoke('check-payment-status', {
        body: { token, midtrans_order_id: midtransOrderId },
      });
      if (data?.paid) {
        setPaid(true);
        clearIntervals();
        setTimeout(() => onSuccess(), 1500);
      }
    } catch {
      // ignore, retry next tick
    } finally {
      setChecking(false);
    }
  };

  const clearIntervals = () => {
    if (pollRef.current) clearInterval(pollRef.current);
    if (countdownRef.current) clearInterval(countdownRef.current);
  };

  useEffect(() => {
    // Start polling
    pollRef.current = setInterval(() => {
      if (Date.now() - startedAt.current >= MAX_WAIT_MS) {
        setExpired(true);
        clearIntervals();
        return;
      }
      checkStatus();
    }, POLL_INTERVAL_MS);

    // Countdown timer
    countdownRef.current = setInterval(() => {
      setSecondsLeft(prev => {
        if (prev <= 1) {
          setExpired(true);
          clearIntervals();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearIntervals();
  }, []);

  const formatTime = (s: number) =>
    `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)',
      display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 3000,
    }}>
      <div style={{
        background: 'white', borderRadius: '24px 24px 0 0',
        width: '100%', maxWidth: '480px', padding: '24px 24px 36px',
      }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <div>
            <p style={{ margin: 0, fontSize: '17px', fontWeight: '700', color: theme.text }}>
              📱 Scan QRIS to Pay
            </p>
            <p style={{ margin: '4px 0 0', fontSize: '13px', color: theme.textMuted }}>
              {formatCurrency(amount)}
            </p>
          </div>
          {!paid && (
            <button
              onClick={onClose}
              style={{ background: 'none', border: 'none', fontSize: '22px', cursor: 'pointer', color: theme.textMuted, lineHeight: 1 }}
            >
              ✕
            </button>
          )}
        </div>

        {paid ? (
          /* Success state */
          <div style={{ textAlign: 'center', padding: '24px 0' }}>
            <div style={{ fontSize: '64px', marginBottom: '12px' }}>✅</div>
            <p style={{ fontSize: '20px', fontWeight: 'bold', color: theme.success, margin: '0 0 6px' }}>
              Payment Confirmed!
            </p>
            <p style={{ fontSize: '14px', color: theme.textMuted, margin: 0 }}>
              Thank you. Your payment has been received.
            </p>
          </div>
        ) : expired ? (
          /* Expired state */
          <div style={{ textAlign: 'center', padding: '24px 0' }}>
            <div style={{ fontSize: '48px', marginBottom: '12px' }}>⏰</div>
            <p style={{ fontSize: '18px', fontWeight: 'bold', color: theme.error, margin: '0 0 6px' }}>
              QR Code Expired
            </p>
            <p style={{ fontSize: '14px', color: theme.textMuted, margin: '0 0 20px' }}>
              Please try again to generate a new QR code.
            </p>
            <button
              onClick={onClose}
              style={{
                padding: '12px 32px', background: theme.gradientPrimary,
                color: 'white', border: 'none', borderRadius: '10px',
                fontSize: '15px', fontWeight: 'bold', cursor: 'pointer',
              }}
            >
              Close
            </button>
          </div>
        ) : (
          /* QR code display */
          <>
            {/* QR image */}
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '16px' }}>
              <div style={{
                border: `3px solid ${theme.primary}`, borderRadius: '16px',
                padding: '12px', background: 'white',
              }}>
                <img
                  src={qrCodeUrl}
                  alt="QRIS Payment Code"
                  style={{ width: '220px', height: '220px', display: 'block' }}
                />
              </div>
            </div>

            {/* Countdown */}
            <div style={{ textAlign: 'center', marginBottom: '14px' }}>
              <p style={{ margin: 0, fontSize: '12px', color: theme.textMuted }}>
                QR expires in
              </p>
              <p style={{
                margin: '4px 0 0', fontSize: '22px', fontWeight: 'bold',
                color: secondsLeft < 60 ? theme.error : theme.primary,
                fontFamily: 'monospace',
              }}>
                {formatTime(secondsLeft)}
              </p>
            </div>

            {/* Auto-check indicator */}
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              gap: '8px', padding: '10px', background: '#f5f5f5', borderRadius: '10px',
              marginBottom: '12px',
            }}>
              <span style={{
                width: '8px', height: '8px', borderRadius: '50%',
                background: checking ? theme.warning : theme.success,
                animation: 'pulse 1.5s infinite',
              }} />
              <span style={{ fontSize: '12px', color: theme.textMuted }}>
                {checking ? 'Checking payment...' : 'Waiting for payment...'}
              </span>
            </div>

            <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}`}</style>

            {/* Instructions */}
            <div style={{ fontSize: '12px', color: theme.textMuted, lineHeight: '1.7', textAlign: 'center' }}>
              <p style={{ margin: 0 }}>Open your banking / e-wallet app and scan the QR code above.</p>
              <p style={{ margin: '4px 0 0' }}>Payment will be confirmed automatically.</p>
            </div>

            {/* Sandbox testing helper — shows QR string for simulator */}
            {qrString && import.meta.env.VITE_MIDTRANS_ENV !== 'production' && (
              <div style={{ marginTop: '12px', background: '#fff8e1', border: '1px solid #ffe082', borderRadius: '8px', padding: '10px' }}>
                <p style={{ margin: '0 0 6px', fontSize: '11px', color: '#f57f17', fontWeight: '600' }}>
                  🧪 Sandbox: copy QR String for simulator
                </p>
                <div
                  onClick={() => navigator.clipboard.writeText(qrString)}
                  style={{
                    fontSize: '10px', fontFamily: 'monospace', color: '#555',
                    wordBreak: 'break-all', cursor: 'pointer',
                    background: 'white', border: '1px solid #ddd', borderRadius: '6px',
                    padding: '6px', maxHeight: '48px', overflow: 'hidden',
                  }}
                  title="Click to copy"
                >
                  {qrString}
                </div>
                <p style={{ margin: '4px 0 0', fontSize: '10px', color: '#999', textAlign: 'right' }}>tap to copy</p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
