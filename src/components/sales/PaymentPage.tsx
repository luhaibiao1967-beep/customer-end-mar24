// components/sales/PaymentPage.js
import React, { useState } from "react";
import { supabase } from "../../supabaseClient";
import {
  DollarSign,
  Search,
  Camera,
  X,
  CheckCircle,
  AlertCircle,
} from "lucide-react";
import { getCurrentJakartaDateString, formatDateJakarta } from "../../utils/timezoneHelpers";

export default function PaymentPage({ currentUser, orders, loadOrders }) {
  const [searchTerm, setSearchTerm] = useState("");
  const [filter, setFilter] = useState("all"); // all, paid, unpaid
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [paymentEvidence, setPaymentEvidence] = useState(null);

  const handlePaymentUpload = (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setPaymentEvidence(reader.result);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleMarkAsPaid = async (orderId, withEvidence = false) => {
    const updateData = {
      payment_status: "paid",
      paid_date: getCurrentJakartaDateString(),
    };

    if (withEvidence && paymentEvidence) {
      updateData.payment_evidence = paymentEvidence;
    }

    const { error } = await supabase
      .from("orders")
      .update(updateData)
      .eq("id", orderId);

    if (error) {
      alert("Error: " + error.message);
    } else {
      await loadOrders(currentUser.branch);
      setShowPaymentModal(false);
      setSelectedOrder(null);
      setPaymentEvidence(null);
      alert("Payment recorded successfully!");
    }
  };

  const getPaymentColor = (status) => {
    return status === "paid"
      ? "bg-green-100 text-green-800 border-green-300"
      : "bg-red-100 text-red-800 border-red-300";
  };

  // Filter and search orders
  const filteredOrders = orders.filter((order) => {
    const matchesSearch =
      order.customer_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      order.customer_address.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesFilter = filter === "all" || order.payment_status === filter;
    return matchesSearch && matchesFilter;
  });

  const totalReceivable = orders
    .filter((o) => o.payment_status === "unpaid")
    .reduce((sum, o) => sum + o.total_amount, 0);

  return (
    <div className="p-4 space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold">Payment Management</h2>
      </div>

      {/* Receivables Card */}
      <div className="bg-gradient-to-r from-red-500 to-red-600 text-white rounded-lg shadow-lg p-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-red-100 mb-1">Total Receivables</p>
            <p className="text-3xl font-bold">
              Rp {totalReceivable.toLocaleString()}
            </p>
            <p className="text-sm text-red-100 mt-2">
              {orders.filter((o) => o.payment_status === "unpaid").length}{" "}
              unpaid orders
            </p>
          </div>
          <DollarSign size={64} className="text-red-200 opacity-50" />
        </div>
      </div>

      {/* Search and Filter */}
      <div className="space-y-3">
        <div className="relative">
          <Search
            className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400"
            size={20}
          />
          <input
            type="text"
            placeholder="Search by customer name or address..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-3 border-2 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
          />
        </div>

        <div className="flex gap-2 overflow-x-auto">
          <button
            onClick={() => setFilter("all")}
            className={`px-4 py-2 rounded-lg font-medium whitespace-nowrap transition ${
              filter === "all"
                ? "bg-blue-600 text-white"
                : "bg-gray-100 text-gray-700 hover:bg-gray-200"
            }`}
          >
            All ({orders.length})
          </button>
          <button
            onClick={() => setFilter("unpaid")}
            className={`px-4 py-2 rounded-lg font-medium whitespace-nowrap transition ${
              filter === "unpaid"
                ? "bg-red-500 text-white"
                : "bg-gray-100 text-gray-700 hover:bg-gray-200"
            }`}
          >
            Unpaid ({orders.filter((o) => o.payment_status === "unpaid").length}
            )
          </button>
          <button
            onClick={() => setFilter("paid")}
            className={`px-4 py-2 rounded-lg font-medium whitespace-nowrap transition ${
              filter === "paid"
                ? "bg-green-500 text-white"
                : "bg-gray-100 text-gray-700 hover:bg-gray-200"
            }`}
          >
            Paid ({orders.filter((o) => o.payment_status === "paid").length})
          </button>
        </div>
      </div>

      {/* Payment Modal */}
      {showPaymentModal && selectedOrder && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg p-6 max-w-md w-full">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-bold">Record Payment</h3>
              <button
                onClick={() => {
                  setShowPaymentModal(false);
                  setSelectedOrder(null);
                  setPaymentEvidence(null);
                }}
                className="text-gray-500 hover:text-gray-700"
              >
                <X size={24} />
              </button>
            </div>

            <div className="mb-4 p-4 bg-gray-50 rounded-lg">
              <p className="text-sm text-gray-600">Customer</p>
              <p className="font-bold text-lg">{selectedOrder.customer_name}</p>
              <p className="text-2xl font-bold text-green-600 mt-2">
                Rp {selectedOrder.total_amount.toLocaleString()}
              </p>
            </div>

            <div className="mb-4">
              <label className="block text-sm font-medium mb-2">
                Payment Evidence (Optional)
              </label>
              <label className="block w-full">
                <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center cursor-pointer hover:border-blue-500 hover:bg-blue-50 transition">
                  <Camera size={48} className="mx-auto mb-2 text-gray-400" />
                  <p className="text-sm text-gray-600">
                    Click to upload screenshot
                  </p>
                  <p className="text-xs text-gray-500 mt-1">
                    JPG, PNG (Max 5MB)
                  </p>
                </div>
                <input
                  type="file"
                  accept="image/*"
                  onChange={handlePaymentUpload}
                  className="hidden"
                />
              </label>
            </div>

            {paymentEvidence && (
              <div className="mb-4">
                <p className="text-sm font-medium mb-2">Preview:</p>
                <img
                  src={paymentEvidence}
                  alt="Payment Evidence"
                  className="w-full h-48 object-contain border rounded-lg bg-gray-50"
                />
              </div>
            )}

            <div className="space-y-2">
              <button
                onClick={() => handleMarkAsPaid(selectedOrder.id, true)}
                className="w-full bg-green-600 text-white py-3 rounded-lg hover:bg-green-700 font-bold transition"
              >
                {paymentEvidence ? "Mark Paid with Evidence" : "Mark as Paid"}
              </button>
              <button
                onClick={() => {
                  setShowPaymentModal(false);
                  setSelectedOrder(null);
                  setPaymentEvidence(null);
                }}
                className="w-full bg-gray-300 text-gray-700 py-3 rounded-lg hover:bg-gray-400 transition"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Orders List */}
      <div className="space-y-3">
        {filteredOrders.length === 0 ? (
          <div className="bg-white p-12 rounded-lg shadow text-center text-gray-500">
            <DollarSign size={48} className="mx-auto mb-3 text-gray-400" />
            <p className="text-lg font-medium">No orders found</p>
            <p className="text-sm mt-2">Try adjusting your search or filter</p>
          </div>
        ) : (
          filteredOrders.map((order) => (
            <div
              key={order.id}
              className="bg-white rounded-lg shadow-md overflow-hidden"
            >
              <div className="p-4">
                <div className="flex justify-between items-start mb-3">
                  <div>
                    <h3 className="text-lg font-bold text-gray-900">
                      {order.customer_name}
                    </h3>
                    <p className="text-sm text-gray-600">
                      {order.customer_address}
                    </p>
                    <p className="text-xs text-gray-500 mt-1">
                     Order #{order.id} • {formatDateJakarta(order.delivery_date)}
                    </p>
                  </div>
                  <span
                    className={`px-3 py-1 rounded-full text-xs font-bold border-2 ${getPaymentColor(
                      order.payment_status
                    )}`}
                  >
                    {order.payment_status.toUpperCase()}
                  </span>
                </div>

                {/* Items Summary */}
                {order.order_items && order.order_items.length > 0 && (
                  <div className="bg-gray-50 rounded p-2 mb-3">
                    <p className="text-xs font-semibold text-gray-600 mb-1">
                      Items:
                    </p>
                    <div className="text-sm text-gray-700">
                      {order.order_items.map((item, idx) => (
                        <span key={idx}>
                          {item.product} × {item.quantity}
                          {idx < order.order_items.length - 1 ? ", " : ""}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Amount */}
                <div className="flex justify-between items-center py-3 border-t">
                  <span className="text-sm text-gray-600">Total Amount:</span>
                  <span className="text-2xl font-bold text-green-600">
                    Rp {order.total_amount.toLocaleString()}
                  </span>
                </div>

                {/* Payment Actions */}
                {order.payment_status === "unpaid" ? (
                  <div className="flex gap-2 mt-3">
                    <button
                      onClick={() => handleMarkAsPaid(order.id, false)}
                      className="flex-1 bg-gray-600 text-white py-2 rounded-lg hover:bg-gray-700 font-medium transition flex items-center justify-center gap-2"
                    >
                      <CheckCircle size={18} />
                      Quick Mark Paid
                    </button>
                    <button
                      onClick={() => {
                        setSelectedOrder(order);
                        setShowPaymentModal(true);
                      }}
                      className="flex-1 bg-green-600 text-white py-2 rounded-lg hover:bg-green-700 font-medium transition flex items-center justify-center gap-2"
                    >
                      <Camera size={18} />
                      With Evidence
                    </button>
                  </div>
                ) : (
                  <div className="mt-3">
                    <div className="flex items-center gap-2 text-sm text-green-700 bg-green-50 p-3 rounded-lg border border-green-200">
                      <CheckCircle size={18} />
                      <div className="flex-1">
                        <p className="font-medium">Payment Received</p>
                        {order.paid_date && (
                          <p className="text-xs text-green-600">
                            Paid on: {formatDateJakarta(order.paid_date)}
                          </p>
                        )}
                      </div>
                    </div>

                    {order.payment_evidence && (
                      <div className="mt-2">
                        <p className="text-xs font-semibold text-gray-600 mb-1">
                          Payment Evidence:
                        </p>
                        <img
                          src={order.payment_evidence}
                          alt="Payment Evidence"
                          className="w-full h-32 object-contain border rounded-lg bg-gray-50 cursor-pointer hover:bg-gray-100"
                          onClick={() =>
                            window.open(order.payment_evidence, "_blank")
                          }
                        />
                        <p className="text-xs text-gray-500 mt-1 text-center">
                          Click to view full size
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Payment Summary */}
      {filteredOrders.length > 0 && (
        <div className="bg-white rounded-lg shadow-lg p-4">
          <h3 className="font-bold text-lg mb-3">Payment Summary</h3>
          <div className="grid grid-cols-2 gap-4">
            <div className="text-center p-3 bg-red-50 rounded-lg">
              <p className="text-2xl font-bold text-red-600">
                {orders.filter((o) => o.payment_status === "unpaid").length}
              </p>
              <p className="text-xs text-gray-600">Unpaid Orders</p>
              <p className="text-sm font-bold text-red-600 mt-1">
                Rp{" "}
                {orders
                  .filter((o) => o.payment_status === "unpaid")
                  .reduce((sum, o) => sum + o.total_amount, 0)
                  .toLocaleString()}
              </p>
            </div>
            <div className="text-center p-3 bg-green-50 rounded-lg">
              <p className="text-2xl font-bold text-green-600">
                {orders.filter((o) => o.payment_status === "paid").length}
              </p>
              <p className="text-xs text-gray-600">Paid Orders</p>
              <p className="text-sm font-bold text-green-600 mt-1">
                Rp{" "}
                {orders
                  .filter((o) => o.payment_status === "paid")
                  .reduce((sum, o) => sum + o.total_amount, 0)
                  .toLocaleString()}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
