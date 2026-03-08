// src/Pages/MagicLinkDiagnostics.tsx - Magic Link 发送诊断
import React, { useState, useEffect } from 'react';
import { supabase } from '../supabaseClient';

interface EnvStatus {
  ENVIRONMENT: string;
  dev_mode: boolean;
  WA_TEMPLATE_MAGIC_LINK: string;
  WA_TEMPLATE_MAGIC_LINK_SIMPLE: string;
  WA_CLOUD_API_TOKEN: string;
  WA_CLOUD_PHONE_NUMBER_ID: string;
  APP_URL: string;
  WA_BUSINESS_WHATSAPP_NUMBER: string;
}

interface MessageRow {
  id: string;
  phone: string;
  status: string;
  sent_at: string;
  error_detail: string;
}

interface DiagResult {
  success: boolean;
  env?: EnvStatus;
  summary?: {
    total_attempts: number;
    sent: number;
    failed: number;
    diagnosis: string;
  };
  recent_messages?: MessageRow[];
  error?: string;
}

export default function MagicLinkDiagnostics() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [data, setData] = useState<DiagResult | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const fetchDiagnostics = async () => {
    try {
      setError('');
      const { data: result, error: fnError } = await supabase.functions.invoke('auth-magic-link-diagnostics');
      if (fnError) throw fnError;
      setData(result);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch diagnostics');
      setData(null);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchDiagnostics();
  }, []);

  const handleRefresh = () => {
    setRefreshing(true);
    fetchDiagnostics();
  };

  if (loading) {
    return (
      <div style={styles.page}>
        <div style={styles.card}>
          <div style={styles.spinner} />
          <p>Loading diagnostics...</p>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <h1 style={styles.title}>🔍 Magic Link Diagnostics</h1>
        <p style={styles.subtitle}>Troubleshoot why Magic Links are not being delivered</p>

        {error && (
          <div style={styles.errorBox}>
            ⚠️ {error}
          </div>
        )}

        {data?.success && data.env && (
          <>
            {/* Diagnosis */}
            <div style={{
              ...styles.box,
              background: data.summary?.diagnosis?.includes('⚠️') ? '#fff3cd' : data.summary?.diagnosis?.includes('❌') ? '#f8d7da' : '#d4edda',
              borderColor: data.summary?.diagnosis?.includes('⚠️') ? '#ffc107' : data.summary?.diagnosis?.includes('❌') ? '#f5c6cb' : '#c3e6cb',
            }}>
              <strong>Diagnosis</strong>
              <p style={{ margin: '8px 0 0 0', fontSize: '15px' }}>{data.summary?.diagnosis}</p>
            </div>

            {/* Env Config */}
            <h2 style={styles.sectionTitle}>Environment Config</h2>
            <div style={styles.table}>
              <div style={styles.row}>
                <span style={styles.label}>ENVIRONMENT</span>
                <span style={data.env.dev_mode ? styles.bad : styles.good}>{data.env.ENVIRONMENT}</span>
                {data.env.dev_mode && <span style={styles.bad}> → WhatsApp messages will NOT be sent</span>}
              </div>
              <div style={styles.row}>
                <span style={styles.label}>WA_TEMPLATE_MAGIC_LINK</span>
                <span style={data.env.WA_TEMPLATE_MAGIC_LINK.includes('✓') ? styles.good : styles.bad}>{data.env.WA_TEMPLATE_MAGIC_LINK}</span>
              </div>
              <div style={styles.row}>
                <span style={styles.label}>WA_CLOUD_API_TOKEN</span>
                <span style={data.env.WA_CLOUD_API_TOKEN.includes('✓') ? styles.good : styles.bad}>{data.env.WA_CLOUD_API_TOKEN}</span>
              </div>
              <div style={styles.row}>
                <span style={styles.label}>WA_CLOUD_PHONE_NUMBER_ID</span>
                <span style={data.env.WA_CLOUD_PHONE_NUMBER_ID.includes('✓') ? styles.good : styles.bad}>{data.env.WA_CLOUD_PHONE_NUMBER_ID}</span>
              </div>
              <div style={styles.row}>
                <span style={styles.label}>APP_URL</span>
                <span>{data.env.APP_URL}</span>
              </div>
              <div style={styles.row}>
                <span style={styles.label}>WA_BUSINESS_WHATSAPP_NUMBER</span>
                <span>{data.env.WA_BUSINESS_WHATSAPP_NUMBER}</span>
              </div>
            </div>

            {/* Summary */}
            <h2 style={styles.sectionTitle}>Send Stats (last 20)</h2>
            <div style={styles.stats}>
              <span>Total: <strong>{data.summary?.total_attempts ?? 0}</strong></span>
              <span style={styles.good}>Sent: <strong>{data.summary?.sent ?? 0}</strong></span>
              <span style={styles.bad}>Failed: <strong>{data.summary?.failed ?? 0}</strong></span>
            </div>

            {/* Recent Messages */}
            <h2 style={styles.sectionTitle}>Recent Messages</h2>
            {data.recent_messages && data.recent_messages.length > 0 ? (
              <div style={styles.msgList}>
                {data.recent_messages.map((m) => (
                  <div key={m.id} style={{ ...styles.msgRow, borderLeftColor: m.status === 'sent' ? '#28a745' : '#dc3545' }}>
                    <div style={styles.msgHeader}>
                      <span>{m.phone}</span>
                      <span style={m.status === 'sent' ? styles.good : styles.bad}>{m.status}</span>
                    </div>
                    <div style={styles.msgMeta}>{new Date(m.sent_at).toLocaleString()}</div>
                    {m.error_detail && (
                      <div style={styles.errorDetail}>{m.error_detail}</div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p style={{ color: '#666' }}>No login_link records found. Try entering a registered WhatsApp number on the login page to trigger a send.</p>
            )}

            {/* Tips */}
            <h2 style={styles.sectionTitle}>Troubleshooting Tips</h2>
            <ul style={styles.tips}>
              <li>If <strong>ENVIRONMENT=development</strong>: delete or change to production in Supabase Secrets</li>
              <li>If <strong>status: failed</strong>: check error details above — common causes: wrong template name, expired token, phone number format</li>
              <li>If <strong>status: sent</strong> but user doesn't receive it: check Meta test number whitelist, WhatsApp message requests, or switch to Live mode</li>
              <li>Secrets changes take effect immediately without redeployment</li>
            </ul>
          </>
        )}

        <div style={styles.footer}>
          <button onClick={handleRefresh} disabled={refreshing} style={styles.btn}>
            {refreshing ? 'Refreshing...' : '🔄 Refresh'}
          </button>
          <a href="/" style={styles.link}>← Back to Login</a>
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh',
    background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)',
    padding: '24px',
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  card: {
    background: 'white',
    borderRadius: '16px',
    boxShadow: '0 10px 40px rgba(0,0,0,0.2)',
    padding: '32px',
    maxWidth: '640px',
    width: '100%',
  },
  spinner: {
    width: '40px',
    height: '40px',
    border: '4px solid #e0e0e0',
    borderTop: '4px solid #667eea',
    borderRadius: '50%',
    margin: '0 auto 16px',
    animation: 'spin 1s linear infinite',
  },
  title: {
    fontSize: '24px',
    margin: '0 0 8px 0',
    color: '#333',
  },
  subtitle: {
    fontSize: '14px',
    color: '#666',
    margin: '0 0 24px 0',
  },
  errorBox: {
    background: '#f8d7da',
    border: '1px solid #f5c6cb',
    borderRadius: '8px',
    padding: '12px',
    color: '#721c24',
    marginBottom: '20px',
  },
  box: {
    padding: '16px',
    borderRadius: '8px',
    border: '1px solid',
    marginBottom: '24px',
  },
  sectionTitle: {
    fontSize: '18px',
    margin: '0 0 12px 0',
    color: '#333',
  },
  table: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    marginBottom: '24px',
  },
  row: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '8px',
    alignItems: 'center',
    fontSize: '14px',
  },
  label: {
    minWidth: '220px',
    color: '#555',
  },
  good: { color: '#28a745', fontWeight: 600 },
  bad: { color: '#dc3545', fontWeight: 600 },
  stats: {
    display: 'flex',
    gap: '24px',
    marginBottom: '24px',
    fontSize: '14px',
  },
  msgList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
    marginBottom: '24px',
  },
  msgRow: {
    background: '#f8f9fa',
    borderLeft: '4px solid',
    borderRadius: '8px',
    padding: '12px',
  },
  msgHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    fontWeight: 600,
    fontSize: '14px',
  },
  msgMeta: {
    fontSize: '12px',
    color: '#666',
    marginTop: '4px',
  },
  errorDetail: {
    fontSize: '12px',
    color: '#dc3545',
    marginTop: '8px',
    fontFamily: 'monospace',
    wordBreak: 'break-all',
  },
  tips: {
    fontSize: '14px',
    color: '#555',
    lineHeight: 1.8,
    paddingLeft: '20px',
    margin: '0 0 24px 0',
  },
  footer: {
    display: 'flex',
    gap: '16px',
    alignItems: 'center',
    paddingTop: '16px',
    borderTop: '1px solid #eee',
  },
  btn: {
    padding: '10px 20px',
    background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    color: 'white',
    border: 'none',
    borderRadius: '8px',
    fontSize: '14px',
    fontWeight: 600,
    cursor: 'pointer',
  },
  link: {
    color: '#667eea',
    textDecoration: 'underline',
    fontSize: '14px',
  },
};
