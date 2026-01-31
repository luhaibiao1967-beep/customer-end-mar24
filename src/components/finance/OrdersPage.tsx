// components/finance/OrdersPage.js - Finance Orders View
import React, { useState, useEffect } from "react";
import { supabase } from "../../supabaseClient";
import { Package, Filter, Search, Download, Eye } from "lucide-react";
import { formatDateLocalizedJakarta, formatDateJakarta, getCurrentJakartaDateString } from "../../utils/timezoneHelpers";

export default function FinanceOrdersPage({ currentUser, orders, loadOrders }) {
  const [filteredOrders, setFilteredOrders] = useState([]);
  const [filter, setFilter] = useState({
    status: "all",
    paymentStatus: "all",
    branch: currentUser.branch === "All" ? "all" : currentUser.branch,
    searchTerm: "",
    dateFrom: "",
    dateTo: "",
  });
  const [branches, setBranches] = useState([]);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [showDetailModal, setShowDetailModal] = useState(false);

  useEffect(() => {
    loadBranches();
    if (loadOrders) {
      loadOrders(currentUser.branch);
    }
  }, []);

  useEffect(() => {
    applyFilters();
  }, [orders, filter]);

  const loadBranches = async () => {
    const { data } = await supabase
      .from("branches")
      .select("*")
      .eq("status", "active")
      .order("name");
    if (data) setBranches(data);
  };

  const applyFilters = () => {
    let result = [...orders];

    // Filter by status
    if (filter.status !== "all") {
      result = result.filter((o) => o.status === filter.status);
    }

    // Filter by payment status
    if (filter.paymentStatus !== "all") {
      result = result.filter((o) => o.payment_status === filter.paymentStatus);
    }

    // Filter by branch
    if (filter.branch !== "all") {
      result = result.filter((o) => o.branch === filter.branch);
    }

    // Filter by search term (customer name)
    if (filter.searchTerm) {
      result = result.filter((o) =>
        o.customer_name?.toLowerCase().includes(filter.searchTerm.toLowerCase())
      );
    }

    // Filter by date range
    if (filter.dateFrom) {
      result = result.filter(
        (o) => formatDateJakarta(o.delivery_date) >= filter.dateFrom
      );
    }
    if (filter.dateTo) {
      result = result.filter(
        (o) => formatDateJakarta(o.delivery_date) <= filter.dateTo
      );
    }

    setFilteredOrders(result);
  };

  const handleViewDetails = (order) => {
    setSelectedOrder(order);
    setShowDetailModal(true);
  };

  const exportToCSV = () => {
    const headers = [
      "Order ID",
      "Date",
      "Customer",
      "Branch",
      "Amount",
      "Status",
      "Payment Status",
      "Paid Date",
    ];

    const rows = filteredOrders.map((order) => [
      order.id,
      formatDateLocalizedJakarta(order.created_at),
      order.customer_name,
      order.branch,
      order.total_amount,
      order.status,
      order.payment_status,
       order.paid_date ? formatDateJakarta(order.paid_date) : "-",
    ]);

    const csvContent = [
      headers.join(","),
      ...rows.map((row) => row.join(",")),
    ].join("\n");

    const blob = new Blob([csvContent], { type: "text/csv" });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
   a.download = `finance_orders_${getCurrentJakartaDateString()}.csv`;
    a.click();
  };

  const getStatusColor = (status) => {
    const colors = {
      pending: "bg-yellow-100 text-yellow-800",
      scheduled: "bg-blue-100 text-blue-800",
      delivered: "bg-green-100 text-green-800",
    };
    return colors[status] || "bg-gray-100 text-gray-800";
  };

  const getPaymentColor = (status) => {
    return status === "paid"
      ? "bg-green-100 text-green-800"
      : "bg-red-100 text-red-800";
  };

  // Calculate summary
  const totalRevenue = filteredOrders.reduce(
    (sum, o) => sum + (o.total_amount || 0),
    0
  );
  const paidRevenue = filteredOrders
    .filter((o) => o.payment_status === "paid")
    .reduce((sum, o) => sum + (o.total_amount || 0), 0);
  const unpaidRevenue = filteredOrders
    .filter((o) => o.payment_status === "unpaid")
    .reduce((sum, o) => sum + (o.total_amount || 0), 0);

  return (
    <div className="p-4 max-w-6xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
          <Package className="text-blue-600" />
          Order List
        </h2>
        <p className="text-sm text-gray-600 mt-1">View and track all orders</p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-sm text-gray-600">Total Orders</p>
          <p className="text-2xl font-bold text-gray-900">
            {filteredOrders.length}
          </p>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-sm text-gray-600">Paid Amount</p>
          <p className="text-2xl font-bold text-green-600">
            Rp {paidRevenue.toLocaleString()}
          </p>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-sm text-gray-600">Unpaid Amount</p>
          <p className="text-2xl font-bold text-red-600">
            Rp {unpaidRevenue.toLocaleString()}
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-lg shadow-md p-4 mb-6">
        <div className="flex items-center gap-2 mb-4">
          <Filter size={20} className="text-gray-600" />
          <h3 className="font-semibold text-gray-700">Filters</h3>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Search Customer
            </label>
            <div className="relative">
              <Search
                size={18}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
              />
              <input
                type="text"
                value={filter.searchTerm}
                onChange={(e) =>
                  setFilter({ ...filter, searchTerm: e.target.value })
                }
                placeholder="Search by customer name..."
                className="w-full pl-10 pr-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Order Status
            </label>
            <select
              value={filter.status}
              onChange={(e) => setFilter({ ...filter, status: e.target.value })}
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
            >
              <option value="all">All Status</option>
              <option value="pending">Pending</option>
              <option value="scheduled">Scheduled</option>
              <option value="delivered">Delivered</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Payment Status
            </label>
            <select
              value={filter.paymentStatus}
              onChange={(e) =>
                setFilter({ ...filter, paymentStatus: e.target.value })
              }
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
            >
              <option value="all">All Payment</option>
              <option value="paid">Paid</option>
              <option value="unpaid">Unpaid</option>
            </select>
          </div>

          {currentUser.branch === "All" && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Branch
              </label>
              <select
                value={filter.branch}
                onChange={(e) =>
                  setFilter({ ...filter, branch: e.target.value })
                }
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
              >
                <option value="all">All Branches</option>
                {branches.map((branch) => (
                  <option key={branch.id} value={branch.name}>
                    {branch.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Date From
            </label>
            <input
              type="date"
              value={filter.dateFrom}
              onChange={(e) =>
                setFilter({ ...filter, dateFrom: e.target.value })
              }
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Date To
            </label>
            <input
              type="date"
              value={filter.dateTo}
              onChange={(e) => setFilter({ ...filter, dateTo: e.target.value })}
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
            />
          </div>
        </div>

        <div className="flex gap-2 mt-4">
          <button
            onClick={() =>
              setFilter({
                status: "all",
                paymentStatus: "all",
                branch:
                  currentUser.branch === "All" ? "all" : currentUser.branch,
                searchTerm: "",
                dateFrom: "",
                dateTo: "",
              })
            }
            className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition"
          >
            Reset Filters
          </button>
          <button
            onClick={exportToCSV}
            className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition flex items-center gap-2"
          >
            <Download size={18} />
            Export CSV
          </button>
        </div>
      </div>

      {/* Order List */}
      <div className="bg-white rounded-lg shadow-md overflow-hidden">
        <div className="p-4 bg-gray-50 border-b">
          <h3 className="font-semibold text-gray-700">
            Orders ({filteredOrders.length})
          </h3>
        </div>

        {filteredOrders.length === 0 ? (
          <div className="p-8 text-center text-gray-500">
            <Package size={48} className="mx-auto mb-3 text-gray-300" />
            <p className="font-medium">No orders found</p>
            <p className="text-sm">Try adjusting your filters</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-600">
                    Date
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-600">
                    Customer
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-600">
                    Branch
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-600">
                    Amount
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-600">
                    Status
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-600">
                    Payment
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-600">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {filteredOrders.map((order) => (
                  <tr key={order.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-sm">
                      {formatDateLocalizedJakarta(order.created_at)}
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-medium text-sm">
                        {order.customer_name}
                      </p>
                      <p className="text-xs text-gray-500">
                        Delivery: {formatDateJakarta(order.delivery_date)}
                      </p>
                    </td>
                    <td className="px-4 py-3 text-sm">{order.branch}</td>
                    <td className="px-4 py-3 text-sm font-medium">
                      Rp {order.total_amount?.toLocaleString() || 0}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`text-xs px-2 py-1 rounded-full ${getStatusColor(
                          order.status
                        )}`}
                      >
                        {order.status}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`text-xs px-2 py-1 rounded-full ${getPaymentColor(
                          order.payment_status
                        )}`}
                      >
                        {order.payment_status}
                      </span>
                      {order.paid_date && (
                        <p className="text-xs text-gray-500 mt-1">
                          {formatDateJakarta(order.paid_date)}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => handleViewDetails(order)}
                        className="bg-blue-100 text-blue-700 px-3 py-1 rounded text-xs hover:bg-blue-200 transition flex items-center gap-1"
                      >
                        <Eye size={14} />
                        View
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Detail Modal */}
      {showDetailModal && selectedOrder && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex justify-between items-start mb-4">
                <h3 className="text-xl font-bold">Order Details</h3>
                <button
                  onClick={() => setShowDetailModal(false)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  ✕
                </button>
              </div>

              <div className="space-y-4">
                <div>
                  <p className="text-sm text-gray-600">Customer</p>
                  <p className="font-medium">{selectedOrder.customer_name}</p>
                  <p className="text-sm text-gray-600">
                    {selectedOrder.customer_address}
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm text-gray-600">Branch</p>
                    <p className="font-medium">{selectedOrder.branch}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-600">Delivery Date</p>
                    <p className="font-medium">{formatDateJakarta(selectedOrder.delivery_date)}</p>
                  </div>
                </div>

                <div>
                  <p className="text-sm text-gray-600 mb-2">Order Items</p>
                  <div className="bg-gray-50 rounded p-3 text-sm">
                    <p>
                      Items information will be loaded from order_items table
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm text-gray-600">Status</p>
                    <span
                      className={`inline-block text-xs px-2 py-1 rounded-full ${getStatusColor(
                        selectedOrder.status
                      )}`}
                    >
                      {selectedOrder.status}
                    </span>
                  </div>
                  <div>
                    <p className="text-sm text-gray-600">Payment Status</p>
                    <span
                      className={`inline-block text-xs px-2 py-1 rounded-full ${getPaymentColor(
                        selectedOrder.payment_status
                      )}`}
                    >
                      {selectedOrder.payment_status}
                    </span>
                  </div>
                </div>

                <div className="bg-blue-50 p-4 rounded">
                  <p className="text-sm text-gray-600">Total Amount</p>
                  <p className="text-2xl font-bold text-blue-600">
                    Rp {selectedOrder.total_amount?.toLocaleString() || 0}
                  </p>
                </div>

                {selectedOrder.payment_evidence && (
                  <div>
                    <p className="text-sm text-gray-600 mb-2">
                      Payment Evidence
                    </p>
                    <img
                      src={selectedOrder.payment_evidence}
                      alt="Payment Evidence"
                      className="w-full max-h-64 object-contain border rounded"
                    />
                  </div>
                )}

                {selectedOrder.delivery_evidence && (
                  <div>
                    <p className="text-sm text-gray-600 mb-2">
                      Delivery Evidence
                    </p>
                    <img
                      src={selectedOrder.delivery_evidence}
                      alt="Delivery Evidence"
                      className="w-full max-h-64 object-contain border rounded"
                    />
                  </div>
                )}
              </div>

              <button
                onClick={() => setShowDetailModal(false)}
                className="w-full mt-6 bg-gray-200 text-gray-700 py-2 rounded-lg hover:bg-gray-300"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
