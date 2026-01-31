// components/finance/ReportsPage.tsx - Finance Reports & Analytics
import React, { useState, useEffect } from "react";
import { supabase } from "../../supabaseClient";
import {
  BarChart,
  TrendingUp,
  DollarSign,
  Calendar,
  Download,
  RefreshCw,
} from "lucide-react";
import { formatDateJakarta, formatDateLocalizedJakarta, getCurrentJakartaDateString } from 
"../../utils/timezoneHelpers";

// Type definitions
interface Order {
  id: string;
  customer_id: string;
  customer_name: string;
  customer_address: string;
  customer_whatsapp: string;
  branch: string;
  total_amount: number;
  status: string;
  payment_status: "paid" | "unpaid";
  delivery_date: string;
  created_at: string;
  created_by: string;
}

interface User {
  id: string;
  name: string;
  email: string;
  role: string;
  branch: string;
}

interface RevenueData {
  total: number;
  paid: number;
  unpaid: number;
  count: number;
}

interface DailyData extends RevenueData {
  date: string;
}

interface MonthlyData extends RevenueData {
  month: string;
}

interface BranchData extends RevenueData {
  branch: string;
}

interface PaymentStatusData {
  paid: {
    count: number;
    total: number;
  };
  unpaid: {
    count: number;
    total: number;
  };
}

interface ReportData {
  daily: DailyData[];
  monthly: MonthlyData[];
  byBranch: BranchData[];
  byPaymentStatus: PaymentStatusData;
}

interface DateRange {
  from: string;
  to: string;
}

interface Props {
  currentUser: User;
  orders: Order[];
  loadOrders?: (branch: string) => Promise<void>;
}

export default function FinanceReportsPage({
  currentUser,
  orders,
  loadOrders,
}: Props) {
  const [reportData, setReportData] = useState<ReportData>({
    daily: [],
    monthly: [],
    byBranch: [],
    byPaymentStatus: { 
      paid: { count: 0, total: 0 }, 
      unpaid: { count: 0, total: 0 } 
    },
  });
  
  const [dateRange, setDateRange] = useState<DateRange>({
    from: formatDateJakarta(new Date(new Date().setDate(new Date().getDate() - 30))),
    to: getCurrentJakartaDateString(),
  });
  
  const [loading, setLoading] = useState<boolean>(false);

  useEffect(() => {
    if (loadOrders) {
      loadOrders(currentUser.branch);
    }
  }, []);

  useEffect(() => {
    generateReports();
  }, [orders, dateRange]);

  const generateReports = (): void => {
    setLoading(true);

    // Filter orders by date range
    const filteredOrders = orders.filter((order) => {
      const orderDate = new Date(order.created_at);
      const fromDate = new Date(dateRange.from);
      const toDate = new Date(dateRange.to);
      return orderDate >= fromDate && orderDate <= toDate;
    });

    // Daily revenue
    const dailyRevenue: Record<string, RevenueData> = {};
    filteredOrders.forEach((order) => {
      const date = formatDateLocalizedJakarta(order.created_at);
      if (!dailyRevenue[date]) {
        dailyRevenue[date] = {
          total: 0,
          paid: 0,
          unpaid: 0,
          count: 0,
        };
      }
      dailyRevenue[date].total += order.total_amount || 0;
      dailyRevenue[date].count += 1;
      if (order.payment_status === "paid") {
        dailyRevenue[date].paid += order.total_amount || 0;
      } else {
        dailyRevenue[date].unpaid += order.total_amount || 0;
      }
    });

    // Monthly revenue
    const monthlyRevenue: Record<string, RevenueData> = {};
    filteredOrders.forEach((order) => {
      const month = new Date(order.created_at).toLocaleString("default", {
        month: "short",
        year: "numeric",
      });
      if (!monthlyRevenue[month]) {
        monthlyRevenue[month] = {
          total: 0,
          paid: 0,
          unpaid: 0,
          count: 0,
        };
      }
      monthlyRevenue[month].total += order.total_amount || 0;
      monthlyRevenue[month].count += 1;
      if (order.payment_status === "paid") {
        monthlyRevenue[month].paid += order.total_amount || 0;
      } else {
        monthlyRevenue[month].unpaid += order.total_amount || 0;
      }
    });

    // By branch
    const branchRevenue: Record<string, RevenueData> = {};
    filteredOrders.forEach((order) => {
      if (!branchRevenue[order.branch]) {
        branchRevenue[order.branch] = {
          total: 0,
          paid: 0,
          unpaid: 0,
          count: 0,
        };
      }
      branchRevenue[order.branch].total += order.total_amount || 0;
      branchRevenue[order.branch].count += 1;
      if (order.payment_status === "paid") {
        branchRevenue[order.branch].paid += order.total_amount || 0;
      } else {
        branchRevenue[order.branch].unpaid += order.total_amount || 0;
      }
    });

    // By payment status
    const paymentStatusData: PaymentStatusData = {
      paid: {
        count: filteredOrders.filter((o) => o.payment_status === "paid").length,
        total: filteredOrders
          .filter((o) => o.payment_status === "paid")
          .reduce((sum, o) => sum + (o.total_amount || 0), 0),
      },
      unpaid: {
        count: filteredOrders.filter((o) => o.payment_status === "unpaid")
          .length,
        total: filteredOrders
          .filter((o) => o.payment_status === "unpaid")
          .reduce((sum, o) => sum + (o.total_amount || 0), 0),
      },
    };

    setReportData({
      daily: Object.entries(dailyRevenue).map(([date, data]) => ({
        date,
        ...data,
      })),
      monthly: Object.entries(monthlyRevenue).map(([month, data]) => ({
        month,
        ...data,
      })),
      byBranch: Object.entries(branchRevenue).map(([branch, data]) => ({
        branch,
        ...data,
      })),
      byPaymentStatus: paymentStatusData,
    });

    setLoading(false);
  };

  const exportReport = (): void => {
    const csvData: (string | number)[][] = [
      ["Finance Report"],
      [`Period: ${dateRange.from} to ${dateRange.to}`],
      [],
      ["Branch Summary"],
      ["Branch", "Orders", "Total Revenue", "Paid", "Unpaid"],
      ...reportData.byBranch.map((b) => [
        b.branch,
        b.count,
        b.total,
        b.paid,
        b.unpaid,
      ]),
      [],
      ["Monthly Summary"],
      ["Month", "Orders", "Total Revenue", "Paid", "Unpaid"],
      ...reportData.monthly.map((m) => [
        m.month,
        m.count,
        m.total,
        m.paid,
        m.unpaid,
      ]),
    ];

    const csvContent = csvData.map((row) => row.join(",")).join("\n");
    const blob = new Blob([csvContent], { type: "text/csv" });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `finance_report_${getCurrentJakartaDateString()}.csv`;
    a.click();
  };

  // Calculate totals
  const totalRevenue: number = orders.reduce(
    (sum, o) => sum + (o.total_amount || 0),
    0
  );
  const paidRevenue: number = orders
    .filter((o) => o.payment_status === "paid")
    .reduce((sum, o) => sum + (o.total_amount || 0), 0);
  const unpaidRevenue: number = orders
    .filter((o) => o.payment_status === "unpaid")
    .reduce((sum, o) => sum + (o.total_amount || 0), 0);
  const collectionRate: string =
    totalRevenue > 0 ? ((paidRevenue / totalRevenue) * 100).toFixed(1) : "0";

  return (
    <div className="p-4 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex justify-between items-center mb-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
            <BarChart className="text-blue-600" />
            Financial Reports
          </h2>
          <p className="text-sm text-gray-600 mt-1">
            Analytics and performance metrics
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => loadOrders && loadOrders(currentUser.branch)}
            className="bg-gray-200 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-300 transition flex items-center gap-2"
          >
            <RefreshCw size={18} />
            Refresh
          </button>
          <button
            onClick={exportReport}
            className="bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700 transition flex items-center gap-2"
          >
            <Download size={18} />
            Export
          </button>
        </div>
      </div>

      {/* Date Range Filter */}
      <div className="bg-white rounded-lg shadow-md p-4 mb-6">
        <div className="flex items-center gap-4">
          <Calendar className="text-blue-600" size={20} />
          <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                From
              </label>
              <input
                type="date"
                value={dateRange.from}
                onChange={(e) =>
                  setDateRange({ ...dateRange, from: e.target.value })
                }
                className="w-full px-3 py-2 border rounded-lg"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                To
              </label>
              <input
                type="date"
                value={dateRange.to}
                onChange={(e) =>
                  setDateRange({ ...dateRange, to: e.target.value })
                }
                className="w-full px-3 py-2 border rounded-lg"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-white rounded-lg shadow p-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm text-gray-600">Total Revenue</p>
            <DollarSign className="text-blue-600" size={24} />
          </div>
          <p className="text-2xl font-bold text-blue-600">
            Rp {totalRevenue.toLocaleString()}
          </p>
          <p className="text-xs text-gray-500 mt-1">{orders.length} orders</p>
        </div>

        <div className="bg-white rounded-lg shadow p-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm text-gray-600">Paid</p>
            <TrendingUp className="text-green-600" size={24} />
          </div>
          <p className="text-2xl font-bold text-green-600">
            Rp {paidRevenue.toLocaleString()}
          </p>
          <p className="text-xs text-gray-500 mt-1">
            {orders.filter((o) => o.payment_status === "paid").length} orders
          </p>
        </div>

        <div className="bg-white rounded-lg shadow p-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm text-gray-600">Unpaid</p>
            <DollarSign className="text-red-600" size={24} />
          </div>
          <p className="text-2xl font-bold text-red-600">
            Rp {unpaidRevenue.toLocaleString()}
          </p>
          <p className="text-xs text-gray-500 mt-1">
            {orders.filter((o) => o.payment_status === "unpaid").length} orders
          </p>
        </div>

        <div className="bg-white rounded-lg shadow p-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm text-gray-600">Collection Rate</p>
            <BarChart className="text-purple-600" size={24} />
          </div>
          <p className="text-2xl font-bold text-purple-600">
            {collectionRate}%
          </p>
          <p className="text-xs text-gray-500 mt-1">Payment efficiency</p>
        </div>
      </div>

      {/* Branch Performance */}
      <div className="bg-white rounded-lg shadow-md p-6 mb-6">
        <h3 className="font-bold text-lg mb-4">Revenue by Branch</h3>
        {reportData.byBranch.length === 0 ? (
          <p className="text-gray-500 text-center py-8">No data available</p>
        ) : (
          <div className="space-y-4">
            {reportData.byBranch.map((branch) => (
              <div
                key={branch.branch}
                className="border-b pb-4 last:border-b-0"
              >
                <div className="flex justify-between items-start mb-2">
                  <div>
                    <h4 className="font-semibold text-gray-800">
                      {branch.branch}
                    </h4>
                    <p className="text-sm text-gray-600">
                      {branch.count} orders
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-bold text-lg text-gray-900">
                      Rp {branch.total.toLocaleString()}
                    </p>
                    <p className="text-xs text-green-600">
                      Paid: Rp {branch.paid.toLocaleString()}
                    </p>
                    <p className="text-xs text-red-600">
                      Unpaid: Rp {branch.unpaid.toLocaleString()}
                    </p>
                  </div>
                </div>
                {/* Progress Bar */}
                <div className="w-full bg-gray-200 rounded-full h-2">
                  <div
                    className="bg-green-600 h-2 rounded-full transition-all"
                    style={{
                      width: `${
                        branch.total > 0
                          ? (branch.paid / branch.total) * 100
                          : 0
                      }%`,
                    }}
                  ></div>
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  {branch.total > 0
                    ? ((branch.paid / branch.total) * 100).toFixed(1)
                    : 0}
                  % collected
                </p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Monthly Trend */}
      <div className="bg-white rounded-lg shadow-md p-6 mb-6">
        <h3 className="font-bold text-lg mb-4">Monthly Revenue Trend</h3>
        {reportData.monthly.length === 0 ? (
          <p className="text-gray-500 text-center py-8">No data available</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-2 text-left text-sm font-medium text-gray-600">
                    Month
                  </th>
                  <th className="px-4 py-2 text-right text-sm font-medium text-gray-600">
                    Orders
                  </th>
                  <th className="px-4 py-2 text-right text-sm font-medium text-gray-600">
                    Total
                  </th>
                  <th className="px-4 py-2 text-right text-sm font-medium text-gray-600">
                    Paid
                  </th>
                  <th className="px-4 py-2 text-right text-sm font-medium text-gray-600">
                    Unpaid
                  </th>
                  <th className="px-4 py-2 text-right text-sm font-medium text-gray-600">
                    Rate
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {reportData.monthly.map((month) => (
                  <tr key={month.month} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium">{month.month}</td>
                    <td className="px-4 py-3 text-right">{month.count}</td>
                    <td className="px-4 py-3 text-right font-medium">
                      Rp {month.total.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-right text-green-600">
                      Rp {month.paid.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-right text-red-600">
                      Rp {month.unpaid.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className="px-2 py-1 bg-purple-100 text-purple-800 rounded text-xs font-medium">
                        {month.total > 0
                          ? ((month.paid / month.total) * 100).toFixed(1)
                          : 0}
                        %
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Payment Status Distribution */}
      <div className="bg-white rounded-lg shadow-md p-6">
        <h3 className="font-bold text-lg mb-4">Payment Status Distribution</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="border rounded-lg p-4">
            <div className="flex items-center justify-between mb-2">
              <h4 className="font-semibold text-green-800">Paid Orders</h4>
              <span className="text-2xl font-bold text-green-600">
                {reportData.byPaymentStatus.paid.count}
              </span>
            </div>
            <p className="text-3xl font-bold text-green-600 mb-1">
              Rp {reportData.byPaymentStatus.paid.total.toLocaleString()}
            </p>
            <div className="w-full bg-gray-200 rounded-full h-3">
              <div
                className="bg-green-600 h-3 rounded-full"
                style={{
                  width: `${
                    orders.length > 0
                      ? (reportData.byPaymentStatus.paid.count /
                          orders.length) *
                        100
                      : 0
                  }%`,
                }}
              ></div>
            </div>
            <p className="text-xs text-gray-600 mt-2">
              {orders.length > 0
                ? (
                    (reportData.byPaymentStatus.paid.count / orders.length) *
                    100
                  ).toFixed(1)
                : 0}
              % of total orders
            </p>
          </div>

          <div className="border rounded-lg p-4">
            <div className="flex items-center justify-between mb-2">
              <h4 className="font-semibold text-red-800">Unpaid Orders</h4>
              <span className="text-2xl font-bold text-red-600">
                {reportData.byPaymentStatus.unpaid.count}
              </span>
            </div>
            <p className="text-3xl font-bold text-red-600 mb-1">
              Rp {reportData.byPaymentStatus.unpaid.total.toLocaleString()}
            </p>
            <div className="w-full bg-gray-200 rounded-full h-3">
              <div
                className="bg-red-600 h-3 rounded-full"
                style={{
                  width: `${
                    orders.length > 0
                      ? (reportData.byPaymentStatus.unpaid.count /
                          orders.length) *
                        100
                      : 0
                  }%`,
                }}
              ></div>
            </div>
            <p className="text-xs text-gray-600 mt-2">
              {orders.length > 0
                ? (
                    (reportData.byPaymentStatus.unpaid.count / orders.length) *
                    100
                  ).toFixed(1)
                : 0}
              % of total orders
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
