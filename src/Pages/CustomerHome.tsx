// src/Pages/CustomerHome.tsx - Main customer dashboard and ordering
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../supabaseClient';

interface Customer {
  id: string;
  name: string;
  address: string;
  whatsapp: string;
  customer_type: string;
  voucher_balance: number;
  branch: string | null;
}

interface CustomerHomeProps {
  customer: Customer;
}

export default function CustomerHome({ customer: initialCustomer }: CustomerHomeProps) {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [customer, setCustomer] = useState<Customer>(initialCustomer); 
  
  const handleSignOut = async () => {
    setLoading(true);
    await supabase.auth.signOut();
    navigate('/login');
  };

   const handleAddressUpdate = async () => {
    const newAddress = prompt('Enter new address:', customer.addr || '');
    if (newAddress && newAddress !== customer.addr) {
      try {
        // Update address in the database
        const { error } = await supabase
          .from('customers')
          .update({ addr: newAddress }) // Ensure correct column name "addr"
          .eq('id', customer.id);

        if (error) {
          throw new Error(`Failed to update address: ${error.message}`);
        }

        // Update local state dynamically
        setCustomer((prev) => ({
          ...prev,
          addr: newAddress,
        }));

        alert('Address updated successfully!');
      } catch (err) {
        console.error('Error updating address:', err);
        alert('Failed to update address. Please try again.');
      }
    }
  };

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
      padding: '20px'
    }}>
      {/* Navigation Bar */}
      <div style={{
        maxWidth: '1200px',
        margin: '0 auto 20px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center'
      }}>
        <h1 style={{ color: 'white', fontSize: '24px', margin: 0 }}>
          💧 Water Delivery
        </h1>
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
          {loading ? '...' : '🚪 Sign Out'}
        </button>
      </div>

      {/* Main Content */}
      <div style={{
        maxWidth: '800px',
        margin: '0 auto'
      }}>
        {/* Welcome Card */}
        <div style={{
          background: 'white',
          borderRadius: '20px',
          padding: '40px',
          marginBottom: '20px',
          boxShadow: '0 10px 40px rgba(0,0,0,0.2)'
        }}>
          <div style={{ textAlign: 'center', marginBottom: '30px' }}>
            <div style={{
              width: '100px',
              height: '100px',
              background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 20px',
              fontSize: '50px'
            }}>
              👋
            </div>
            <h2 style={{ fontSize: '32px', margin: '0 0 10px 0' }}>
              Welcome, {customer.name}!
            </h2>
            <p style={{ color: '#666', margin: 0 }}>
              Your water delivery dashboard
            </p>
          </div>

          {/* Customer Info */}
          <div style={{ marginBottom: '20px' }}>
            {/* Address - Editable */}
            <div style={{
              background: '#f5f5f5',
              padding: '20px',
              borderRadius: '12px',
              marginBottom: '15px'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                <p style={{ fontSize: '12px', color: '#999', margin: 0 }}>📍 Delivery Address</p>
                <button                 
                  onClick={handleAddressUpdate}

                  style={{
                    background: 'none',
                    border: 'none',
                    color: '#667eea',
                    fontSize: '12px',
                    cursor: 'pointer',
                    textDecoration: 'underline'
                  }}
                >
                  ✏️ Edit
                </button>
              </div>
              <p style={{ fontSize: '14px', color: '#333', margin: 0, fontWeight: '500' }}>
                 {customer.address}
              </p>
            </div>

             {/* Customer Info Panels */}
            <div style={{ display: 'flex', gap: '10px', marginBottom: '20px' }}>
              {/* Service Branch Panel */}
              <div style={{
                background: '#f5f5f5',
                padding: '20px',
                borderRadius: '12px',
                flex: 1,
                textAlign: 'center',
              }}>
                <p style={{ fontSize: '14px', color: '#999', margin: '0 0 5px 0' }}>🏢 Service Branch</p>
                <p style={{ fontSize: '16px', color: '#333', margin: 0, fontWeight: '500' }}>
                  {customer.branch || 'Not assigned'}
                </p>
              </div>

            {/* WhatsApp Panel */}
              <div style={{
                background: '#f5f5f5',
                padding: '20px',
                borderRadius: '12px',
                flex: 1,
                textAlign: 'center',
              }}>
                <p style={{ fontSize: '14px', color: '#999', margin: '0 0 5px 0' }}>💬 WhatsApp</p>
                <p style={{ fontSize: '16px', color: '#333', margin: 0, fontWeight: '500' }}>
                  {customer.whatsapp || 'Not provided'}
                </p>
              </div>
            </div>
          </div>

          {/* Voucher Balance - Only for pre_pay customers */}
          {customer.customer_type === 'pre_pay' && (
            <div style={{ marginBottom: '20px' }}>
              <div style={{
                background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                padding: '20px',
                borderRadius: '12px',
                textAlign: 'center',
                color: 'white'
              }}>
                <p style={{ fontSize: '12px', margin: '0 0 8px 0', opacity: 0.9 }}>
                  Voucher Balance
                </p>
                <p style={{ fontSize: '36px', fontWeight: 'bold', margin: 0 }}>
                  {customer.voucher_balance}
                </p>
                <p style={{ fontSize: '12px', margin: '8px 0 0 0', opacity: 0.9 }}>
                  vouchers available
                </p>
              </div>
            </div>
          )}

          {/* Action Buttons - Conditional based on customer_type */}
          {customer.customer_type === 'pre_pay' ? (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
              <button
                onClick={() => navigate('/orders')}
                disabled={!customer.branch}
                style={{
                  padding: '14px',
                  background: customer.branch ? 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' : '#ccc',
                  color: 'white',
                  border: 'none',
                  borderRadius: '8px',
                  fontSize: '16px',
                  fontWeight: 'bold',
                  cursor: customer.branch ? 'pointer' : 'not-allowed'
                }}
              >
                🛒 Order Now
              </button>
              <button
                onClick={() => navigate('/buy-vouchers')}
                style={{
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
                🎫 Buy Vouchers
              </button>
            </div>
          ) : (
            <button
              onClick={() => navigate('/orders')}
              disabled={!customer.branch}
              style={{
                width: '100%',
                padding: '14px',
                background: customer.branch ? 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' : '#ccc',
                color: 'white',
                border: 'none',
                borderRadius: '8px',
                fontSize: '16px',
                fontWeight: 'bold',
                cursor: customer.branch ? 'pointer' : 'not-allowed'
              }}
            >
              🛒 Order Now
            </button>
          )}
        </div>

        {/* Quick Stats */}
        <div style={{
          background: 'white',
          borderRadius: '20px',
          padding: '30px',
          boxShadow: '0 10px 40px rgba(0,0,0,0.2)'
        }}>
          <h3 style={{ fontSize: '20px', marginBottom: '20px' }}>📊 Quick Info</h3>
          
          <div style={{ fontSize: '14px', color: '#666', lineHeight: '1.8' }}>
            <p style={{ margin: '0 0 10px 0' }}>
              <strong>Account Status:</strong> {customer.branch ? '✅ Active' : '⏳ Pending Setup'}
            </p>
            <p style={{ margin: '0 0 10px 0' }}>
              <strong>Payment Type:</strong> {customer.customer_type === 'pre_pay' ? 'Prepaid (Voucher)' : 'Postpaid (Invoice)'}
            </p>
            {customer.customer_type === 'pre_pay' && (
              <p style={{ margin: '0 0 10px 0' }}>
                <strong>Vouchers:</strong> {customer.voucher_balance} available {customer.voucher_balance === 0 && '(⚠️ Buy vouchers to order)'}
              </p>
            )}
            <p style={{ margin: 0 }}>
              <strong>Support:</strong> Contact us via WhatsApp at {customer.whatsapp}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
