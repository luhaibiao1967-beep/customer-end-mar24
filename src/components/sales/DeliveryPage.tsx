// components/sales/DeliveryPage.js
import React, { useState } from "react";
import { Truck, MapPin, Calendar, Package } from "lucide-react";

export default function DeliveryPage({ orders }) {
  const [filter, setFilter] = useState("all"); // all, pending, scheduled, delivered

  const getStatusColor = (status) => {
    const colors = {
      pending: "bg-yellow-100 text-yellow-800 border-yellow-300",
      scheduled: "bg-blue-100 text-blue-800 border-blue-300",
      delivered: "bg-green-100 text-green-800 border-green-300",
    };
    return colors[status] || "bg-gray-100 text-gray-800 border-gray-300";
  };

  const getStatusIcon = (status) => {
    if (status === "delivered") return "✅";
    if (status === "scheduled") return "🚚";
    return "⏳";
  };

  const filteredOrders =
    filter === "all" ? orders : orders.filter((o) => o.status === filter);

  return (
    <div className="p-4 space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold">Delivery Information</h2>
        <div className="text-sm text-gray-600">View Only</div>
      </div>

      {/* Filter Buttons */}
      <div className="bg-white p-3 rounded-lg shadow-md flex gap-2 overflow-x-auto">
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
          onClick={() => setFilter("pending")}
          className={`px-4 py-2 rounded-lg font-medium whitespace-nowrap transition ${
            filter === "pending"
              ? "bg-yellow-500 text-white"
              : "bg-gray-100 text-gray-700 hover:bg-gray-200"
          }`}
        >
          Pending ({orders.filter((o) => o.status === "pending").length})
        </button>
        <button
          onClick={() => setFilter("scheduled")}
          className={`px-4 py-2 rounded-lg font-medium whitespace-nowrap transition ${
            filter === "scheduled"
              ? "bg-blue-500 text-white"
              : "bg-gray-100 text-gray-700 hover:bg-gray-200"
          }`}
        >
          Scheduled ({orders.filter((o) => o.status === "scheduled").length})
        </button>
        <button
          onClick={() => setFilter("delivered")}
          className={`px-4 py-2 rounded-lg font-medium whitespace-nowrap transition ${
            filter === "delivered"
              ? "bg-green-500 text-white"
              : "bg-gray-100 text-gray-700 hover:bg-gray-200"
          }`}
        >
          Delivered ({orders.filter((o) => o.status === "delivered").length})
        </button>
      </div>

      {/* Info Banner */}
      <div className="bg-blue-50 border-2 border-blue-200 rounded-lg p-4">
        <div className="flex items-start gap-3">
          <Truck className="text-blue-600 flex-shrink-0 mt-1" size={24} />
          <div>
            <h3 className="font-bold text-blue-900 mb-1">
              Delivery Information (View Only)
            </h3>
            <p className="text-sm text-blue-800">
              You can view delivery status here. Only Operators can modify
              delivery schedules and trips.
            </p>
          </div>
        </div>
      </div>

      {/* Orders List */}
      <div className="space-y-3">
        {filteredOrders.length === 0 ? (
          <div className="bg-white p-12 rounded-lg shadow text-center text-gray-500">
            <Truck size={48} className="mx-auto mb-3 text-gray-400" />
            <p className="text-lg font-medium">
              No {filter !== "all" ? filter : ""} deliveries found
            </p>
            <p className="text-sm mt-2">Orders will appear here once created</p>
          </div>
        ) : (
          filteredOrders.map((order) => (
            <div
              key={order.id}
              className="bg-white rounded-lg shadow-md overflow-hidden border-l-4 border-blue-500"
            >
              <div className="p-4">
                {/* Header */}
                <div className="flex justify-between items-start mb-3">
                  <div className="flex items-start gap-3">
                    <div className="text-3xl">
                      {getStatusIcon(order.status)}
                    </div>
                    <div>
                      <h3 className="text-lg font-bold text-gray-900">
                        {order.customer_name}
                      </h3>
                      <div className="flex items-center gap-2 text-sm text-gray-600 mt-1">
                        <MapPin size={14} />
                        <span>{order.customer_address}</span>
                      </div>
                    </div>
                  </div>
                  <span
                    className={`px-3 py-1 rounded-full text-xs font-bold border-2 ${getStatusColor(
                      order.status
                    )}`}
                  >
                    {order.status.toUpperCase()}
                  </span>
                </div>

                {/* Order Details */}
                <div className="bg-gray-50 rounded-lg p-3 mb-3">
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div className="flex items-center gap-2">
                      <Calendar size={16} className="text-gray-500" />
                      <div>
                        <span className="text-gray-600">Delivery Date:</span>
                        <p className="font-bold text-gray-900">
                          {order.delivery_date}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Package size={16} className="text-gray-500" />
                      <div>
                        <span className="text-gray-600">Items:</span>
                        <p className="font-bold text-gray-900">
                          {order.order_items?.length || 0} item(s)
                        </p>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Items List */}
                {order.order_items && order.order_items.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs font-semibold text-gray-600 uppercase">
                      Order Items:
                    </p>
                    {order.order_items.map((item, idx) => (
                      <div
                        key={idx}
                        className="flex justify-between items-center text-sm bg-white border rounded p-2"
                      >
                        <span className="font-medium text-gray-700">
                          {item.product} × {item.quantity}
                        </span>
                        <span className="text-gray-600">
                          Rp{" "}
                          {(
                            (item.unit_price - item.discount) *
                            item.quantity
                          ).toLocaleString()}
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Total Amount */}
                <div className="mt-3 pt-3 border-t flex justify-between items-center">
                  <span className="text-sm text-gray-600">Total Amount:</span>
                  <span className="text-xl font-bold text-green-600">
                    Rp {order.total_amount?.toLocaleString() || "0"}
                  </span>
                </div>

                {/* Delivered Info */}
                {order.status === "delivered" && order.delivered_date && (
                  <div className="mt-3 bg-green-50 border border-green-200 rounded-lg p-3">
                    <p className="text-sm text-green-800">
                      <span className="font-bold">✅ Delivered on:</span>{" "}
                      {order.delivered_date}
                    </p>
                  </div>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Summary Card */}
      {filteredOrders.length > 0 && (
        <div className="bg-gradient-to-r from-blue-500 to-blue-600 text-white rounded-lg shadow-lg p-4">
          <h3 className="font-bold text-lg mb-2">Delivery Summary</h3>
          <div className="grid grid-cols-3 gap-4">
            <div className="text-center">
              <p className="text-2xl font-bold">
                {orders.filter((o) => o.status === "pending").length}
              </p>
              <p className="text-xs text-blue-100">Pending</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold">
                {orders.filter((o) => o.status === "scheduled").length}
              </p>
              <p className="text-xs text-blue-100">Scheduled</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold">
                {orders.filter((o) => o.status === "delivered").length}
              </p>
              <p className="text-xs text-blue-100">Delivered</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
