// components/operator/OrdersPage.tsx - WITH DETAILS & PHOTO BUTTONS
import React, { useState, useEffect } from "react";
import { supabase } from "../../supabaseClient";
import { Package, Calendar, MapPin, DollarSign, Truck, ArrowRight, FileText, Camera, X } from "lucide-react";
import { formatDateJakarta, getCurrentJakartaDateString } from "../../utils/timezoneHelpers";

// Helper function to check if a product is a gallon/water container
// Note: 'galon' is intentionally included to handle common misspelling in product names
const isGallonProduct = (productName) => {
  if (!productName) return false;
  const name = productName.toLowerCase();
  return name.includes('gallon') || 
         name.includes('galon') || 
         name.match(/\d+\s*(l|liter|litre)/i) !== null;
};
export default function OperatorOrdersPage({ currentUser, orders, setActivePage }) {
  const [showDetailsModal, setShowDetailsModal] = useState(false);
  const [showPhotoModal, setShowPhotoModal] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [orderItems, setOrderItems] = useState({});

  // Load order items from database
  useEffect(() => {
    loadOrderItems();
  }, [orders]);

  const loadOrderItems = async () => {
    if (orders.length === 0) return;

    const { data, error } = await supabase
      .from("order_items")
      .select("*")
      .in("order_id", orders.map(o => o.id));

    if (!error && data) {
      const itemsByOrder = {};
      data.forEach(item => {
        if (!itemsByOrder[item.order_id]) {
          itemsByOrder[item.order_id] = [];
        }
        itemsByOrder[item.order_id].push(item);
      });
      setOrderItems(itemsByOrder);
    }
  };

  // Filter orders by branch
  const myOrders = orders.filter((order) => {
    if (currentUser.branch === "All") return true;
    return order.branch === currentUser.branch;
  });

   // Get today's date in YYYY-MM-DD format (Jakarta timezone)
   const today = getCurrentJakartaDateString();

  // Group orders by status
  // Pending: all time (including today)
  const pendingOrders = myOrders.filter((o) => o.status === "pending");
  // Scheduled and Delivered: current day only  
const scheduledOrders = myOrders.filter((o) => {    
if (o.status !== "scheduled") return false;    
const deliveryDate = formatDateJakarta(o.delivery_date);       
return deliveryDate && deliveryDate === today;  
});  
const deliveredOrders = myOrders.filter((o) => {    
if (o.status !== "delivered") return false;    
const deliveryDate = formatDateJakarta(o.delivered_date);      
return deliveryDate && deliveryDate === today;  
});

// Calculate total gallons for a list of orders
  const calculateTotalGallons = (ordersList) => {
    let totalGallons = 0;
    ordersList.forEach(order => {
      const items = orderItems[order.id] || [];
      items.forEach(item => {
        if (isGallonProduct(item.product)) {
          totalGallons += item.quantity || 0;
        }
      });
    });
    return totalGallons;
  };

  // Calculate gallon counts for each status
  const pendingGallons = calculateTotalGallons(pendingOrders);
  const scheduledGallons = calculateTotalGallons(scheduledOrders);
  const deliveredGallons = calculateTotalGallons(deliveredOrders);

const getStatusColor = (status) => {
    const colors = {
      pending: "bg-yellow-100 text-yellow-800 border-yellow-300",
      scheduled: "bg-blue-100 text-blue-800 border-blue-300",
      delivered: "bg-green-100 text-green-800 border-green-300",
    };
    return colors[status] || "bg-gray-100 text-gray-800 border-gray-300";
  };

  const getPaymentColor = (status) => {
    return status === "paid" 
      ? "bg-green-100 text-green-800 border-green-300" 
      : "bg-red-100 text-red-800 border-red-300";
  };

  const OrderCard = ({ order }) => (
    <div className="bg-white p-3 rounded-lg shadow border">
      {/* Header */}
      <div className="flex justify-between items-start gap-2 mb-2">
        <div className="flex-1 min-w-0">
          <h4 className="font-bold text-base truncate">{order.customer_name}</h4>
          <p className="text-xs text-gray-500">#{order.id.substring(0, 8)}</p>
        </div>
        <span className={`text-xs px-2 py-1 rounded-full font-medium border whitespace-nowrap ${getStatusColor(order.status)}`}>
          {order.status}
        </span>
      </div>

      {/* Address */}
      <div className="mb-2">
        <p className="text-sm text-gray-600 flex items-start gap-1">
          <MapPin size={12} className="mt-0.5 flex-shrink-0" />
          <span className="line-clamp-2">{order.customer_address}</span>
        </p>
      </div>

      {/* Info Grid */}
      <div className="grid grid-cols-2 gap-2 text-sm mb-2">
        <div>
          <div className="flex items-center gap-1 text-xs text-gray-600">
            <Calendar size={12} />
            <span>Delivery:</span>
          </div>
          <p className="font-medium text-xs">{formatDateJakarta(order.delivery_date)}</p>
        </div>
        <div>
          <div className="flex items-center gap-1 text-xs text-gray-600">
            <DollarSign size={12} />
            <span>Total:</span>
          </div>
          <p className="font-bold text-sm text-green-600">
            Rp {order.total_amount?.toLocaleString() || 0}
          </p>
        </div>
      </div>

      {/* Action Buttons - Details & Photo */}
      <div className="grid grid-cols-2 gap-2 mb-2">
        <button
          onClick={() => {
            setSelectedOrder(order);
            setShowDetailsModal(true);
          }}
          className="flex items-center justify-center gap-1 bg-blue-100 text-blue-700 py-2 rounded-lg hover:bg-blue-200 font-medium text-sm"
        >
          <FileText size={14} />
          Details
        </button>
        <button
          onClick={() => {
            setSelectedOrder(order);
            setShowPhotoModal(true);
          }}
          className="flex items-center justify-center gap-1 bg-purple-100 text-purple-700 py-2 rounded-lg hover:bg-purple-200 font-medium text-sm"
        >
          <Camera size={14} />
          Photo
        </button>
      </div>

      {/* Footer */}
      <div className="pt-2 border-t flex justify-between items-center">
        <span className={`text-xs px-2 py-1 rounded-full font-medium border ${getPaymentColor(order.payment_status)}`}>
          {order.payment_status}
        </span>
        <span className="text-xs text-gray-500 truncate max-w-[120px]">
          {order.created_by || 'Unknown'}
        </span>
      </div>
    </div>
  );

  return (
    <div className="p-3 space-y-3">
      {/* Header */}
      <div>
        <h2 className="text-xl font-bold">All Orders</h2>
        <p className="text-xs text-gray-600 mt-1">{currentUser.branch} Branch</p>
      </div>

      {/* Help Box - Compact */}
      {pendingOrders.length > 0 && (
        <div className="bg-blue-50 border-2 border-blue-400 rounded-lg p-3">
          <div className="flex items-start gap-2">
            <div className="bg-blue-500 text-white p-2 rounded-full flex-shrink-0">
              <Truck size={16} />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="font-bold text-blue-900 text-sm mb-1">
                {pendingOrders.length} pending order(s)
              </h3>
              <p className="text-xs text-blue-800 mb-2">
                Need to assign to trips
              </p>
              <button
                onClick={() => setActivePage && setActivePage('trips')}
                className="bg-blue-600 text-white px-3 py-2 rounded-lg hover:bg-blue-700 flex items-center gap-2 font-medium text-sm w-full justify-center"
              >
                <Truck size={16} />
                Go to Trips
                <ArrowRight size={16} />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Summary Cards - Compact */}
      {/* Pending: all time | Scheduled & Delivered: today only */}
      <div className="grid grid-cols-3 gap-2">
        <div className="bg-yellow-50 p-3 rounded-lg border-2 border-yellow-200 shadow-sm">
          <div className="text-center">
            <div className="bg-yellow-200 w-8 h-8 rounded-full flex items-center justify-center mx-auto mb-1">
              <Package size={16} className="text-yellow-700" />
            </div>
            <p className="text-xs text-yellow-800 font-medium">Pending</p>
            <p className="text-base font-bold text-yellow-900">{pendingOrders.length} Orders</p>
            <p className="text-sm font-semibold text-yellow-700">{pendingGallons} Gallons</p>
            <p className="text-[10px] text-yellow-600">All time</p>
          </div>
        </div>
        
        <div className="bg-blue-50 p-3 rounded-lg border-2 border-blue-200 shadow-sm">
          <div className="text-center">
            <div className="bg-blue-200 w-8 h-8 rounded-full flex items-center justify-center mx-auto mb-1">
              <Truck size={16} className="text-blue-700" />
            </div>
            <p className="text-xs text-blue-800 font-medium">Scheduled</p>
            <p className="text-base font-bold text-blue-900">{scheduledOrders.length} Orders</p>
            <p className="text-sm font-semibold text-blue-700">{scheduledGallons} Gallons</p>
            <p className="text-[10px] text-blue-600">Today only</p>
          </div>
        </div>
        
        <div className="bg-green-50 p-3 rounded-lg border-2 border-green-200 shadow-sm">
          <div className="text-center">
            <div className="bg-green-200 w-8 h-8 rounded-full flex items-center justify-center mx-auto mb-1">
              <Package size={16} className="text-green-700" />
            </div>
            <p className="text-xs text-green-800 font-medium">Delivered</p>
            <p className="text-base font-bold text-green-900">{deliveredOrders.length} Orders</p>
             <p className="text-sm font-semibold text-green-700">{deliveredGallons} Gallons</p>
            <p className="text-[10px] text-green-600">Today only</p>
          </div>
        </div>
      </div>

      {/* Orders Lists */}
      {pendingOrders.length > 0 && (
        <div>
          <h3 className="font-bold text-sm mb-2 text-yellow-900">Pending Orders</h3>
          <div className="space-y-2">
            {pendingOrders.map((order) => (
              <OrderCard key={order.id} order={order} />
            ))}
          </div>
        </div>
      )}

      {scheduledOrders.length > 0 && (
        <div>
          <h3 className="font-bold text-sm mb-2 text-blue-900">Scheduled Orders</h3>
          <div className="space-y-2">
            {scheduledOrders.map((order) => (
              <OrderCard key={order.id} order={order} />
            ))}
          </div>
        </div>
      )}

      {deliveredOrders.length > 0 && (
        <div>
          <h3 className="font-bold text-sm mb-2 text-green-900">Delivered Orders</h3>
          <div className="space-y-2">
            {deliveredOrders.map((order) => (
              <OrderCard key={order.id} order={order} />
            ))}
          </div>
        </div>
      )}

      {myOrders.length === 0 && (
        <div className="text-center py-12 text-gray-500">
          <Package size={48} className="mx-auto mb-3 text-gray-400" />
          <p className="font-medium">No orders found</p>
        </div>
      )}

      {/* Details Modal */}
      {showDetailsModal && selectedOrder && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg p-6 max-w-md w-full max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-bold">Order Details</h3>
              <button
                onClick={() => {
                  setShowDetailsModal(false);
                  setSelectedOrder(null);
                }}
                className="text-gray-500 hover:text-gray-700"
              >
                <X size={24} />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <p className="text-sm text-gray-600">Customer</p>
                <p className="font-bold">{selectedOrder.customer_name}</p>
                <p className="text-sm text-gray-600">{selectedOrder.customer_address}</p>
              </div>

              <div className="bg-gray-50 p-3 rounded-lg">
                <p className="text-sm font-bold mb-2">Order Items:</p>
                {orderItems[selectedOrder.id]?.length > 0 ? (
                  <div className="space-y-2">
                    {orderItems[selectedOrder.id].map((item, index) => (
                      <div key={item.id || `item-${index}`} className="flex justify-between text-sm border-b pb-2 last:border-0">
                        <div>
                          <p className="font-medium">{item.product}</p>
                          <p className="text-xs text-gray-600">
                            {item.quantity} × Rp {((item.unit_price || 0) - (item.discount || 0)).toLocaleString()}
                          </p>
                        </div>
                        <p className="font-bold">
                          Rp {(((item.unit_price || 0) - (item.discount || 0)) * item.quantity).toLocaleString()}
                        </p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-gray-500">No items</p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-gray-600">Delivery Date</p>
                  <p className="font-medium">{formatDateJakarta(selectedOrder.delivery_date)}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-600">Status</p>
                  <span className={`inline-block text-xs px-2 py-1 rounded-full ${getStatusColor(selectedOrder.status)}`}>
                    {selectedOrder.status}
                  </span>
                </div>
                <div>
                  <p className="text-sm text-gray-600">Payment</p>
                  <span className={`inline-block text-xs px-2 py-1 rounded-full ${getPaymentColor(selectedOrder.payment_status)}`}>
                    {selectedOrder.payment_status}
                  </span>
                </div>
                <div>
                  <p className="text-sm text-gray-600">Total Amount</p>
                  <p className="font-bold text-green-600">
                    Rp {selectedOrder.total_amount?.toLocaleString() || 0}
                  </p>
                </div>
              </div>

              <div className="bg-blue-50 p-3 rounded-lg">
                <p className="text-sm text-gray-600">Created By</p>
                <p className="font-medium">{selectedOrder.created_by || 'Unknown'}</p>
              </div>
            </div>

            <button
              onClick={() => {
                setShowDetailsModal(false);
                setSelectedOrder(null);
              }}
              className="w-full mt-4 bg-gray-300 text-gray-700 py-3 rounded-lg hover:bg-gray-400 font-medium"
            >
              Close
            </button>
          </div>
        </div>
      )}

      {/* Photo Modal - Delivery Confirmation */}
      {showPhotoModal && selectedOrder && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg p-6 max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-4">
              <div>
                <h3 className="text-lg font-bold">Delivery Confirmation Photo</h3>
                <p className="text-sm text-gray-600">{selectedOrder.customer_name}</p>
              </div>
              <button
                onClick={() => {
                  setShowPhotoModal(false);
                  setSelectedOrder(null);
                }}
                className="text-gray-500 hover:text-gray-700"
              >
                <X size={24} />
              </button>
            </div>

            {selectedOrder.delivery_evidence ? (
              <div>
                {selectedOrder.delivery_evidence.startsWith('data:image') || selectedOrder.delivery_evidence.startsWith('http') ? (
                  <img
                    src={selectedOrder.delivery_evidence}
                    alt="Delivery Confirmation"
                    className="w-full max-h-[60vh] object-contain border rounded-lg bg-gray-50"
                    onError={(e) => {
                      const target = e.currentTarget;
                      target.onerror = null;
                      target.src = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='400' height='300'%3E%3Crect width='400' height='300' fill='%23f3f4f6'/%3E%3Ctext x='50%25' y='50%25' dominant-baseline='middle' text-anchor='middle' font-family='sans-serif' font-size='16' fill='%236b7280'%3EImage not available%3C/text%3E%3C/svg%3E";
                    }}
                  />
                ) : (
                  <div className="bg-gray-100 p-12 rounded-lg text-center">
                    <Camera size={48} className="mx-auto mb-3 text-gray-400" />
                    <p className="text-gray-600">Invalid image format</p>
                  </div>
                )}
              </div>
            ) : (
              <div className="bg-gray-100 p-12 rounded-lg text-center">
                <Camera size={48} className="mx-auto mb-3 text-gray-400" />
                <p className="text-gray-600 font-medium">No delivery photo uploaded</p>
                <p className="text-sm text-gray-500 mt-2">
                  {selectedOrder.status === 'delivered' 
                    ? 'Delivery photo not taken' 
                    : 'Order not yet delivered'}
                </p>
              </div>
            )}

            <button
              onClick={() => {
                setShowPhotoModal(false);
                setSelectedOrder(null);
              }}
              className="w-full mt-4 bg-gray-300 text-gray-700 py-3 rounded-lg hover:bg-gray-400 font-medium"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
