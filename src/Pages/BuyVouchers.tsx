// src/Pages/BuyVouchers.tsx - Voucher purchase page
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

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
  name: string;
  vouchers: number;
  price: number;
  savings?: number;
  popular?: boolean;
}

const VOUCHER_PACKAGES: VoucherPackage[] = [
  {
    id: 'single',
    name: 'Single Voucher',
    vouchers: 1,
    price: 15000,
  },
  {
    id: 'package_10',
    name: '10 Vouchers',
    vouchers: 10,
    price: 140000,
    savings: 10000,
  },
  {
    id: 'package_20',
    name: '20 Vouchers',
    vouchers: 20,
    price: 270000,
    savings: 30000,
    popular: true,
  },
  {
    id: 'package_50',
    name: '50 Vouchers',
    vouchers: 50,
    price: 650000,
    savings: 100000,
  },
];

export default function BuyVouchers({ customer }: BuyVouchersProps) {
  const navigate = useNavigate();
  const [selectedPackage, setSelectedPackage] = useState<VoucherPackage | null>(null);
  const [showPaymentModal, setShowPaymentModal] = useState(false);

  const formatCurrency = (amount: number): string => {
    return new Intl.NumberFormat('id-ID', {
      style: 'currency',
      currency: 'IDR',
      minimumFractionDigits: 0,
    }).format(amount);
  };

  const handleBuyNow = (pkg: VoucherPackage) => {
    setSelectedPackage(pkg);
    setShowPaymentModal(true);
  };

  if (customer.customer_type !== 'pre_pay') {
    return (
      <div style={{
        minHeight: '100vh',
        background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '20px'
      }}>
        <div style={{
          background: 'white',
          borderRadius: '20px',
          padding: '40px',
          maxWidth: '500px',
          textAlign: 'center'
        }}>
          <p style={{ fontSize: '48px', margin: '0 0 20px 0' }}>ℹ️</p>
          <h2 style={{ fontSize: '24px', marginBottom: '15px' }}>Vouchers Not Available</h2>
          <p style={{ color: '#666', marginBottom: '30px' }}>
            Your account is set to postpaid (invoice) mode.<br />
            Vouchers are only for prepaid customers.
          </p>
          <button
            onClick={() => navigate('/')}
            style={{
              padding: '12px 30px',
              background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
              color: 'white',
              border: 'none',
              borderRadius: '8px',
              fontSize: '16px',
              fontWeight: 'bold',
              cursor: 'pointer'
            }}
          >
            ← Back to Home
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
      padding: '20px'
    }}>
      {/* Header */}
      <div style={{
        maxWidth: '1200px',
        margin: '0 auto 30px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center'
      }}>
        <button
          onClick={() => navigate('/')}
          style={{
            padding: '10px 20px',
            background: 'rgba(255,255,255,0.2)',
            color: 'white',
            border: '2px solid white',
            borderRadius: '8px',
            fontSize: '14px',
            fontWeight: 'bold',
            cursor: 'pointer'
          }}
        >
          ← Back
        </button>
        <h1 style={{ color: 'white', fontSize: '24px', margin: 0 }}>
          🎫 Buy Vouchers
        </h1>
        <div style={{ width: '100px' }} /> {/* Spacer */}
      </div>

      {/* Current Balance */}
      <div style={{
        maxWidth: '1200px',
        margin: '0 auto 30px'
      }}>
        <div style={{
          background: 'white',
          borderRadius: '20px',
          padding: '30px',
          textAlign: 'center',
          boxShadow: '0 10px 40px rgba(0,0,0,0.2)'
        }}>
          <p style={{ fontSize: '14px', color: '#999', margin: '0 0 10px 0' }}>
            Current Balance
          </p>
          <p style={{ fontSize: '48px', fontWeight: 'bold', margin: '0 0 5px 0', color: '#667eea' }}>
            {customer.voucher_balance}
          </p>
          <p style={{ fontSize: '14px', color: '#666', margin: 0 }}>
            vouchers available
          </p>
        </div>
      </div>

      {/* Voucher Packages */}
      <div style={{
        maxWidth: '1200px',
        margin: '0 auto',
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
        gap: '20px'
      }}>
        {VOUCHER_PACKAGES.map((pkg) => (
          <div
            key={pkg.id}
            style={{
              background: 'white',
              borderRadius: '20px',
              padding: '30px',
              boxShadow: '0 10px 40px rgba(0,0,0,0.2)',
              position: 'relative',
              border: pkg.popular ? '3px solid #ffc107' : 'none'
            }}
          >
            {pkg.popular && (
              <div style={{
                position: 'absolute',
                top: '-15px',
                left: '50%',
                transform: 'translateX(-50%)',
                background: '#ffc107',
                color: '#000',
                padding: '5px 20px',
                borderRadius: '20px',
                fontSize: '12px',
                fontWeight: 'bold'
              }}>
                ⭐ MOST POPULAR
              </div>
            )}

            <div style={{ textAlign: 'center', marginBottom: '20px' }}>
              <p style={{ fontSize: '48px', margin: '0 0 10px 0' }}>🎫</p>
              <h3 style={{ fontSize: '20px', margin: '0 0 10px 0' }}>{pkg.name}</h3>
              <p style={{ fontSize: '36px', fontWeight: 'bold', color: '#667eea', margin: '0 0 5px 0' }}>
                {pkg.vouchers}
              </p>
              <p style={{ fontSize: '14px', color: '#999', margin: 0 }}>vouchers</p>
            </div>

            <div style={{
              background: '#f5f5f5',
              borderRadius: '12px',
              padding: '15px',
              marginBottom: '15px',
              textAlign: 'center'
            }}>
              <p style={{ fontSize: '24px', fontWeight: 'bold', margin: '0 0 5px 0', color: '#333' }}>
                {formatCurrency(pkg.price)}
              </p>
              {pkg.savings && (
                <p style={{ fontSize: '12px', color: '#28a745', margin: 0, fontWeight: 'bold' }}>
                  💰 Save {formatCurrency(pkg.savings)}
                </p>
              )}
            </div>

            <button
              onClick={() => handleBuyNow(pkg)}
              style={{
                width: '100%',
                padding: '14px',
                background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                color: 'white',
                border: 'none',
                borderRadius: '8px',
                fontSize: '16px',
                fontWeight: 'bold',
                cursor: 'pointer'
              }}
            >
              Buy Now
            </button>
          </div>
        ))}
      </div>

      {/* Payment Modal */}
      {showPaymentModal && selectedPackage && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0,0,0,0.7)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '20px',
          zIndex: 1000
        }}>
          <div style={{
            background: 'white',
            borderRadius: '20px',
            padding: '40px',
            maxWidth: '500px',
            width: '100%',
            textAlign: 'center'
          }}>
            <h2 style={{ fontSize: '24px', marginBottom: '20px' }}>
              🎫 {selectedPackage.name}
            </h2>

            <div style={{
              background: '#f5f5f5',
              borderRadius: '12px',
              padding: '20px',
              marginBottom: '20px'
            }}>
              <p style={{ fontSize: '14px', color: '#999', margin: '0 0 5px 0' }}>Total Amount</p>
              <p style={{ fontSize: '36px', fontWeight: 'bold', color: '#667eea', margin: 0 }}>
                {formatCurrency(selectedPackage.price)}
              </p>
            </div>

            <div style={{
              background: '#fff3cd',
              border: '1px solid #ffc107',
              borderRadius: '12px',
              padding: '15px',
              marginBottom: '20px',
              fontSize: '14px',
              color: '#856404'
            }}>
              🚧 <strong>Development Mode:</strong><br />
              QRIS payment integration coming soon!<br />
              In production, this will show a QR code for payment.
            </div>

            <div style={{ display: 'flex', gap: '10px' }}>
              <button
                onClick={() => {
                  setShowPaymentModal(false);
                  setSelectedPackage(null);
                }}
                style={{
                  flex: 1,
                  padding: '14px',
                  background: '#ccc',
                  color: '#333',
                  border: 'none',
                  borderRadius: '8px',
                  fontSize: '16px',
                  fontWeight: 'bold',
                  cursor: 'pointer'
                }}
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  alert('Payment integration coming soon! In production, QRIS will be displayed here.');
                  setShowPaymentModal(false);
                }}
                style={{
                  flex: 1,
                  padding: '14px',
                  background: 'linear-gradient(135deg, #28a745 0%, #20c997 100%)',
                  color: 'white',
                  border: 'none',
                  borderRadius: '8px',
                  fontSize: '16px',
                  fontWeight: 'bold',
                  cursor: 'pointer'
                }}
              >
                Pay with QRIS
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
