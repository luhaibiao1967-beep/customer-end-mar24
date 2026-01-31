// components/finance/PaymentsPage.js - Finance Payment Management
import React, { useState } from "react";
import { supabase } from "../../supabaseClient";
import {
  DollarSign,
  CheckCircle,
  AlertCircle,
  X,
  Camera,
  RefreshCw,
} from "lucide-react";
import { getCurrentJakartaDateString } from "../../utils/timezoneHelpers";

export default function FinancePaymentsPage({
  currentUser,
  orders,
  loadOrders,
}) {
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [selectedOrderForPayment, setSelectedOrderForPayment] = useState(null);
  const [paymentEvidence, setPaymentEvidence] = useState(null);
  const [paymentEvidencePreview, setPaymentEvidencePreview] = useState(null);
  const [uploadingPayment, setUploadingPayment] = useState(false);
  const [quickMarking, setQuickMarking] = useState(null);
  const [filterStatus, setFilterStatus] = useState("all"); // all, paid, unpaid

  // Filter orders by branch
  const myOrders = orders.filter((order) => {
    if (currentUser.branch === "All") return true;
    return order.branch === currentUser.branch;
  });

  // Apply payment status filter
  const filteredOrders = myOrders.filter((order) => {
    if (filterStatus === "all") return true;
    return order.payment_status === filterStatus;
  });

  // Calculate statistics
  const totalReceivable = myOrders
    .filter((o) => o.payment_status === "unpaid")
    .reduce((sum, o) => sum + (o.total_amount || 0), 0);

  const totalPaid = myOrders
    .filter((o) => o.payment_status === "paid")
    .reduce((sum, o) => sum + (o.total_amount || 0), 0);

  const unpaidCount = myOrders.filter(
    (o) => o.payment_status === "unpaid"
  ).length;
  const paidCount = myOrders.filter((o) => o.payment_status === "paid").length;

  const getPaymentColor = (status) => {
    return status === "paid"
      ? "bg-green-100 text-green-800"
      : "bg-red-100 text-red-800";
  };

  const getStatusColor = (status) => {
    const colors = {
      pending: "bg-yellow-100 text-yellow-800",
      scheduled: "bg-blue-100 text-blue-800",
      delivered: "bg-green-100 text-green-800",
    };
    return colors[status] || "bg-gray-100 text-gray-800";
  };

  const handlePhotoSelect = (e) => {
    const file = e.target.files[0];
    if (file) {
      // Check file size (max 5MB)
      if (file.size > 5 * 1024 * 1024) {
        alert("File size must be less than 5MB");
        return;
      }

      setPaymentEvidence(file);
      const reader = new FileReader();
      reader.onloadend = () => {
        setPaymentEvidencePreview(reader.result);
      };
      reader.readAsDataURL(file);
    }
  };

  // Quick Mark as Paid (No Photo Required)
  const handleQuickMarkPaid = async (orderId) => {
    if (!window.confirm("Mark this order as paid without uploading proof?")) {
      return;
    }

    setQuickMarking(orderId);

    try {
      const { error } = await supabase
        .from("orders")
        .update({
          payment_status: "paid",
          paid_date: getCurrentJakartaDateString(),
          payment_evidence: null,
        })
        .eq("id", orderId);

      if (error) {
        console.error("Error updating payment:", error);
        alert(`Failed to mark as paid: ${error.message}`);
      } else {
        await loadOrders(currentUser.branch);
        alert("✅ Order marked as paid!");
      }
    } catch (error) {
      console.error("Error:", error);
      alert(`Error: ${error.message}`);
    } finally {
      setQuickMarking(null);
    }
  };

  // Mark as Paid with Photo Evidence
  const handleMarkAsPaidWithPhoto = async () => {
    if (!paymentEvidence) {
      alert("Please upload payment evidence (screenshot/photo)");
      return;
    }

    setUploadingPayment(true);

    try {
      // Upload photo to storage
      const fileExt = paymentEvidence.name.split(".").pop();
      const fileName = `payment_${selectedOrderForPayment}_${Date.now()}.${fileExt}`;

      const { error: uploadError } = await supabase.storage
        .from("payment-evidence")
        .upload(fileName, paymentEvidence);

      let photoUrl = paymentEvidencePreview;

      if (!uploadError) {
        const {
          data: { publicUrl },
        } = supabase.storage.from("payment-evidence").getPublicUrl(fileName);
        photoUrl = publicUrl;
      } else {
        console.warn("Storage upload failed, using base64:", uploadError);
      }

      // Update order payment status
      const { error } = await supabase
        .from("orders")
        .update({
          payment_status: "paid",
          paid_date: getCurrentJakartaDateString(),
          payment_evidence: photoUrl,
        })
        .eq("id", selectedOrderForPayment);

      if (error) {
        console.error("Error updating payment:", error);
        alert(`Failed to mark as paid: ${error.message}`);
      } else {
        await loadOrders(currentUser.branch);
        setShowPaymentModal(false);
        setSelectedOrderForPayment(null);
        setPaymentEvidence(null);
        setPaymentEvidencePreview(null);
        alert("✅ Payment confirmed with evidence!");
      }
    } catch (error) {
      console.error("Error:", error);
      alert(`Error: ${error.message}`);
    } finally {
      setUploadingPayment(false);
    }
  };

  const handleOpenPaymentModal = (orderId) => {
    setSelectedOrderForPayment(orderId);
    setPaymentEvidence(null);
    setPaymentEvidencePreview(null);
    setShowPaymentModal(true);
  };

  const handleRefresh = () => {
    if (loadOrders) {
      loadOrders(currentUser.branch);
    }
  };

  return (
    <div className="p-4 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex justify-between items-center mb-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
            <DollarSign className="text-blue-600" />
            Payment Management
          </h2>
          <p className="text-sm text-gray-600 mt-1">
            Track and manage payment status
          </p>
        </div>
        <button
          onClick={handleRefresh}
          className="bg-blue-600 text-white px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-blue-700 transition"
        >
          <RefreshCw size={18} />
          Refresh
        </button>
      </div>

      {/* Payment Photo Modal */}
      {showPaymentModal && (
        <div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg w-full max-w-md">
            <div className="border-b p-4 flex items-center justify-between">
              <h3 className="font-bold text-lg">Upload Payment Evidence</h3>
              <button
                onClick={() => setShowPaymentModal(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                <X size={24} />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <p className="text-sm text-gray-600">
                Please upload a screenshot or photo of the payment
                receipt/transfer confirmation
              </p>

              <div>
                {!paymentEvidencePreview ? (
                  <label className="flex flex-col items-center justify-center w-full h-48 border-2 border-dashed border-blue-400 rounded-lg cursor-pointer bg-blue-50 hover:bg-blue-100 transition">
                    <Camera size={48} className="text-blue-500 mb-2" />
                    <p className="text-sm font-medium text-blue-600">
                      Upload Photo
                    </p>
                    <p className="text-xs text-gray-500 mt-1">
                      or choose from gallery
                    </p>
                    <p className="text-xs text-gray-400 mt-1">Max 5MB</p>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handlePhotoSelect}
                      className="hidden"
                    />
                  </label>
                ) : (
                  <div className="relative">
                    <img
                      src={paymentEvidencePreview}
                      alt="Payment Evidence"
                      className="w-full h-48 object-contain border rounded-lg bg-gray-50"
                    />
                    <button
                      onClick={() => {
                        setPaymentEvidence(null);
                        setPaymentEvidencePreview(null);
                      }}
                      className="absolute top-2 right-2 bg-red-600 text-white p-2 rounded-full hover:bg-red-700"
                    >
                      <X size={20} />
                    </button>
                  </div>
                )}
              </div>

              <div className="flex gap-3">
                <button
                  onClick={handleMarkAsPaidWithPhoto}
                  disabled={!paymentEvidence || uploadingPayment}
                  className="flex-1 bg-green-600 text-white py-3 rounded-lg font-bold disabled:bg-gray-300 hover:bg-green-700 transition"
                >
                  {uploadingPayment ? (
                    <div className="flex items-center justify-center gap-2">
                      <div className="animate-spin rounded-full h-5 w-5 border-2 border-white border-t-transparent"></div>
                      Uploading...
                    </div>
                  ) : (
                    "Confirm Payment"
                  )}
                </button>
                <button
                  onClick={() => setShowPaymentModal(false)}
                  className="px-6 bg-gray-200 text-gray-700 py-3 rounded-lg font-bold hover:bg-gray-300 transition"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="bg-white p-4 rounded-lg shadow">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm text-gray-600">Total Orders</p>
            <DollarSign className="text-blue-600" size={24} />
          </div>
          <p className="text-2xl font-bold text-gray-900">{myOrders.length}</p>
        </div>

        <div className="bg-white p-4 rounded-lg shadow border-l-4 border-green-500">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm text-gray-600">Paid</p>
            <CheckCircle className="text-green-600" size={24} />
          </div>
          <p className="text-2xl font-bold text-green-600">
            Rp {totalPaid.toLocaleString()}
          </p>
          <p className="text-xs text-gray-500 mt-1">{paidCount} orders</p>
        </div>

        <div className="bg-white p-4 rounded-lg shadow border-l-4 border-red-500">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm text-gray-600">Unpaid</p>
            <AlertCircle className="text-red-600" size={24} />
          </div>
          <p className="text-2xl font-bold text-red-600">
            Rp {totalReceivable.toLocaleString()}
          </p>
          <p className="text-xs text-gray-500 mt-1">{unpaidCount} orders</p>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="bg-white rounded-lg shadow-md mb-6">
        <div className="flex border-b">
          <button
            onClick={() => setFilterStatus("all")}
            className={`flex-1 px-6 py-3 font-medium transition ${
              filterStatus === "all"
                ? "text-blue-600 border-b-2 border-blue-600 bg-blue-50"
                : "text-gray-600 hover:text-blue-600 hover:bg-gray-50"
            }`}
          >
            All Orders ({myOrders.length})
          </button>
          <button
            onClick={() => setFilterStatus("unpaid")}
            className={`flex-1 px-6 py-3 font-medium transition ${
              filterStatus === "unpaid"
                ? "text-red-600 border-b-2 border-red-600 bg-red-50"
                : "text-gray-600 hover:text-red-600 hover:bg-gray-50"
            }`}
          >
            Unpaid ({unpaidCount})
          </button>
          <button
            onClick={() => setFilterStatus("paid")}
            className={`flex-1 px-6 py-3 font-medium transition ${
              filterStatus === "paid"
                ? "text-green-600 border-b-2 border-green-600 bg-green-50"
                : "text-gray-600 hover:text-green-600 hover:bg-gray-50"
            }`}
          >
            Paid ({paidCount})
          </button>
        </div>

        {/* Orders List */}
        <div className="p-4">
          {filteredOrders.length === 0 ? (
            <div className="py-12 text-center text-gray-500">
              <DollarSign size={64} className="mx-auto mb-4 text-gray-300" />
              <p className="font-bold text-lg mb-2">
                {filterStatus === "all"
                  ? "No orders yet"
                  : `No ${filterStatus} orders`}
              </p>
              <p className="text-sm">
                {filterStatus === "all"
                  ? "Orders will appear here once created"
                  : `Switch to another tab to view ${
                      filterStatus === "paid" ? "unpaid" : "paid"
                    } orders`}
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {filteredOrders.map((order) => (
                <div
                  key={order.id}
                  className="bg-gray-50 p-4 rounded-lg border hover:border-blue-300 transition"
                >
                  <div className="flex justify-between items-start mb-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="font-bold text-lg">
                          {order.customer_name}
                        </h3>
                        <span
                          className={`text-xs px-2 py-1 rounded-full ${getStatusColor(
                            order.status
                          )}`}
                        >
                          {order.status}
                        </span>
                      </div>
                      <p className="text-sm text-gray-600">
                        {order.customer_address}
                      </p>
                      <div className="flex gap-2 mt-2 text-xs text-gray-500">
                        <span>Order #{order.id.substring(0, 8)}</span>
                        <span>•</span>
                        <span>{order.branch}</span>
                        <span>•</span>
                        <span>Delivery: {order.delivery_date}</span>
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0 ml-4">
                      <p className="text-xl font-bold text-gray-900">
                        Rp {order.total_amount?.toLocaleString() || 0}
                      </p>
                      <span
                        className={`inline-block text-xs px-3 py-1 rounded-full font-medium mt-1 ${getPaymentColor(
                          order.payment_status
                        )}`}
                      >
                        {order.payment_status}
                      </span>
                      {order.payment_status === "paid" && order.paid_date && (
                        <p className="text-xs text-gray-500 mt-1">
                          Paid: {order.paid_date}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Action Buttons */}
                  {order.payment_status === "unpaid" ? (
                    <div className="flex gap-2 mt-3">
                      <button
                        onClick={() => handleQuickMarkPaid(order.id)}
                        disabled={quickMarking === order.id}
                        className="flex-1 bg-green-600 text-white py-2 rounded-lg flex items-center justify-center gap-2 hover:bg-green-700 font-medium text-sm disabled:bg-gray-400 transition"
                      >
                        {quickMarking === order.id ? (
                          <>
                            <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent"></div>
                            Updating...
                          </>
                        ) : (
                          <>
                            <CheckCircle size={16} />
                            Quick Mark Paid
                          </>
                        )}
                      </button>
                      <button
                        onClick={() => handleOpenPaymentModal(order.id)}
                        className="flex-1 bg-blue-600 text-white py-2 rounded-lg flex items-center justify-center gap-2 hover:bg-blue-700 font-medium text-sm transition"
                      >
                        <Camera size={16} />
                        Upload Proof
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-2 mt-3">
                      {order.payment_evidence && (
                        <div>
                          <p className="text-xs text-gray-600 mb-2 font-medium">
                            Payment Evidence:
                          </p>
                          <img
                            src={order.payment_evidence}
                            alt="Payment Evidence"
                            className="w-full h-32 object-contain border rounded-lg bg-white cursor-pointer hover:shadow-lg transition"
                            onClick={() =>
                              window.open(order.payment_evidence, "_blank")
                            }
                          />
                          <p className="text-xs text-gray-500 mt-1 text-center">
                            Click to view full size
                          </p>
                        </div>
                      )}
                      {order.status !== "delivered" && (
                        <div className="flex items-center gap-2 text-sm text-yellow-700 bg-yellow-50 p-3 rounded border border-yellow-200">
                          <AlertCircle size={16} />
                          Paid but not yet delivered
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
