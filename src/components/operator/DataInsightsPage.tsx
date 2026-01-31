// components/operator/DataInsightsPage.tsx - Operators Data Insights
import React, { useState, useEffect } from "react";
import { supabase } from "../../supabaseClient";
import { BarChart, TrendingUp, Package, DollarSign, Calendar, Download } from "lucide-react";
import ExcelJS from 'exceljs';
import { getCurrentJakartaDate, getCurrentJakartaDateString, formatDateJakarta } from 
"../../utils/timezoneHelpers";

// Helper function to check if a product is a gallon/water container
const isGallonProduct = (productName: string): boolean => {
  if (!productName) return false;
  const name = productName.toLowerCase();
  return name.includes('gallon') || 
         name.includes('galon') || 
         name.match(/\d+\s*(l|liter|litre)/i) !== null;
};

// Helper function to format borrowed gallons display
const formatBorrowedGallons = (value: number): string => {
  if (value > 0) return `+${value}`;
  if (value < 0) return `${value}`;
  return `${value}`;
};

// Helper function to get borrowed gallons color class
const getBorrowedGallonsColor = (value: number): string => {
  if (value > 0) return 'text-orange-600';
  if (value < 0) return 'text-blue-600';
  return 'text-green-600';
};

// Helper function to calculate gallons delivered for an order
const calculateGallonsDelivered = (orderId: string, orderItems: any): number => {
  const items = orderItems[orderId] || [];
  let gallonsDelivered = 0;
  items.forEach(item => {
    if (isGallonProduct(item.product)) {
      gallonsDelivered += item.quantity || 0;
    }
  });
  return gallonsDelivered;
};

export default function OperatorDataInsightsPage({
  currentUser,
  orders,
}) {
  const [loading, setLoading] = useState(true);
  const [deliveredOrders, setDeliveredOrders] = useState([]);
  const [orderItems, setOrderItems] = useState({});
  const [selectedPeriod, setSelectedPeriod] = useState("today");
  const [customDateRange, setCustomDateRange] = useState({
     from: getCurrentJakartaDateString(),
    to: getCurrentJakartaDateString(),
  });

  useEffect(() => {
    loadDeliveredOrders();
  }, [orders]);

  useEffect(() => {
    if (deliveredOrders.length > 0) {
      loadOrderItems();
    }
  }, [deliveredOrders]);

  const loadDeliveredOrders = async () => {
    setLoading(true);
    try {
      let query = supabase
        .from("orders")
        .select("*")
        .eq("status", "delivered")
        .order("delivered_date", { ascending: false });

      if (currentUser.branch && currentUser.branch !== "All") {
        query = query.eq("branch", currentUser.branch);
      }

      const { data, error } = await query;

      if (error) {
        console.error("Error loading delivered orders:", error);
        setDeliveredOrders([]);
      } else {
        setDeliveredOrders(data || []);
      }
    } catch (error) {
      console.error("Error loading delivered orders:", error);
      setDeliveredOrders([]);
    } finally {
      setLoading(false);
    }
  };

  const loadOrderItems = async () => {
    if (deliveredOrders.length === 0) return;

    const orderIds = deliveredOrders.map(o => o.id);
    const { data, error } = await supabase
      .from("order_items")
      .select("*")
      .in("order_id", orderIds);

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

  // Date filtering functions
  const getDateRange = () => {
     const today = getCurrentJakartaDate();
    today.setHours(0, 0, 0, 0);

    switch (selectedPeriod) {
      case "today": {
         const todayStr = getCurrentJakartaDateString();
        return { from: todayStr, to: todayStr };
      }
      case "week": {
        const weekAgo = new Date(today);
        weekAgo.setDate(today.getDate() - 7);
        return {
          from: weekAgo.toISOString().split('T')[0],
          to: today.toISOString().split('T')[0]
        };
      }
      case "month": {
        const monthAgo = new Date(today);
        monthAgo.setMonth(today.getMonth() - 1);
        return {
          from: monthAgo.toISOString().split('T')[0],
          to: today.toISOString().split('T')[0]
        };
      }
      case "all":
        return { from: null, to: null };
      case "custom":
        return customDateRange;
      default:
        return { from: null, to: null };
    }
  };

  const filterOrdersByDate = () => {
    const range = getDateRange();
    if (!range.from && !range.to) {
      return deliveredOrders;
    }

    return deliveredOrders.filter(order => {
      if (!order.delivered_date) return false;
      const orderDate = formatDateJakarta(order.delivered_date);
      
      if (range.from && orderDate < range.from) return false;
      if (range.to && orderDate > range.to) return false;
      
      return true;
    });
  };

  const calculateMetrics = () => {
    const filtered = filterOrdersByDate();

    const metrics = {
      deliveredCount: filtered.length,
      totalAmount: 0,
      borrowedGallons: 0,
      gallonsDelivered: 0,
    };

    filtered.forEach(order => {
      // Total amount
      metrics.totalAmount += order.total_amount || 0;

      // Borrowed gallons
      metrics.borrowedGallons += order.borrowed_gallons || 0;

      // Calculate gallons delivered from order items
       metrics.gallonsDelivered += calculateGallonsDelivered(order.id, orderItems);
    });

    return metrics;
  };

  const metrics = calculateMetrics();

    // XLS Export Function
  const exportToXLS = async () => {
    try {
      const filtered = filterOrdersByDate();
      
      // Create a new workbook
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Operator Data');
      
      // Define columns
      worksheet.columns = [
        { header: 'Date of Delivery', key: 'deliveryDate', width: 18 },
        { header: 'Customer Name', key: 'customerName', width: 25 },
        { header: 'Total Delivered Gallons', key: 'gallonsDelivered', width: 22 },
        { header: 'Empty Gallons', key: 'emptyGallons', width: 15 },
        { header: 'Borrowed Gallons', key: 'borrowedGallons', width: 18 },
        { header: 'Total Amount', key: 'totalAmount', width: 15 },
        { header: 'Remarks', key: 'remarks', width: 30 }
      ];
      
      // Add data rows
      filtered.forEach(order => {
        const gallonsDelivered = calculateGallonsDelivered(order.id, orderItems);
        
        worksheet.addRow({
           deliveryDate: formatDateJakarta(order.delivered_date),
          customerName: order.customer_name || "",
          gallonsDelivered: gallonsDelivered,
          emptyGallons: order.empty_gallons_returned || 0,
          borrowedGallons: order.borrowed_gallons || 0,
          totalAmount: order.total_amount || 0,
          remarks: order.note || ""
        });
      });

       // Style the header row
      const headerRow = worksheet.getRow(1);
      headerRow.font = { bold: true };
      headerRow.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFE0E0E0' }
      };

      // Generate filename with period and date
      const periodLabelMap = {
        today: "Today",
        week: "This_Week",
        month: "This_Month",
        custom: "Custom",
        all: "All_Time"
      };
      const periodLabel = periodLabelMap[selectedPeriod] || "All_Time";
      const date = getCurrentJakartaDateString();
      const filename = `operator_data_${periodLabel}_${date}.xlsx`;
      
      // Generate and download file
      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error("Error exporting to Excel:", error);
      alert("Failed to export data. Please try again.");
    }
  };

  if (loading) {
    return (
      <div className="p-4 text-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
        <p className="text-gray-600 mt-2 text-sm">Loading data insights...</p>
      </div>
    );
  }

  return (
    <div className="p-4 pb-20 max-w-6xl mx-auto">
      {/* Header */}
      <div className="mb-4">
        <h2 className="text-xl font-bold text-gray-800 flex items-center gap-2">
          <BarChart className="text-blue-600" size={24} />
          Data Insights
        </h2>
        <p className="text-sm text-gray-600">{currentUser.branch} Branch</p>
      </div>

      {/* Period Filter */}
      <div className="bg-white rounded-lg shadow p-4 mb-4">
        <div className="flex justify-between items-center mb-2">
          <label className="block text-sm font-bold text-gray-700">
            <Calendar size={16} className="inline mr-1" />
            Select Period
          </label>
          <button
            onClick={exportToXLS}
            className="bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700 transition flex items-center gap-2 text-sm font-medium"
          >
            <Download size={16} />
            Export 
          </button>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mb-3">
          {[
            { value: "today", label: "Today" },
            { value: "week", label: "This Week" },
            { value: "month", label: "This Month" },
            { value: "all", label: "All Time" },
            { value: "custom", label: "Custom" },
          ].map(period => (
            <button
              key={period.value}
              onClick={() => setSelectedPeriod(period.value)}
              className={`px-4 py-2 rounded-lg font-medium text-sm transition ${
                selectedPeriod === period.value
                  ? "bg-blue-600 text-white"
                  : "bg-gray-100 text-gray-700 hover:bg-gray-200"
              }`}
            >
              {period.label}
            </button>
          ))}
        </div>

        {/* Custom Date Range */}
        {selectedPeriod === "custom" && (
          <div className="grid grid-cols-2 gap-3 mt-3 p-3 bg-blue-50 rounded-lg border border-blue-200">
            <div>
              <label className="block text-xs font-bold text-gray-700 mb-1">From</label>
              <input
                type="date"
                value={customDateRange.from}
                onChange={(e) => setCustomDateRange({ ...customDateRange, from: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-700 mb-1">To</label>
              <input
                type="date"
                value={customDateRange.to}
                onChange={(e) => setCustomDateRange({ ...customDateRange, to: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg text-sm"
              />
            </div>
          </div>
        )}
      </div>

      {/* Metrics Cards */}
      <div className="flex flex-wrap gap-2 mb-4">
        {/* Delivered Orders Count */}
        <div className="flex-1 min-w-[calc(50%-0.25rem)] sm:min-w-[calc(25%-0.375rem)] bg-gradient-to-br from-blue-500 to-blue-600 rounded-lg shadow-lg p-3 text-white">
          <div className="flex items-center justify-between mb-1">
            <Package size={20} />
            <TrendingUp size={16} className="opacity-70" />
          </div>
          <h3 className="text-xs font-medium opacity-90">Delivered Orders</h3>
          <p className="text-xl sm:text-2xl font-bold mt-0.5">{metrics.deliveredCount}</p>
        </div>

        {/* Gallons Delivered */}
        <div className="flex-1 min-w-[calc(50%-0.25rem)] sm:min-w-[calc(25%-0.375rem)] bg-gradient-to-br from-green-500 to-green-600 rounded-lg shadow-lg p-3 text-white">
          <div className="flex items-center justify-between mb-1">
            <Package size={20} />
            <TrendingUp size={16} className="opacity-70" />
          </div>
          <h3 className="text-xs font-medium opacity-90">Gallons Delivered</h3>
          <p className="text-xl sm:text-2xl font-bold mt-0.5">{metrics.gallonsDelivered}</p>
        </div>

        {/* Borrowed Gallons */}
        <div className="flex-1 min-w-[calc(50%-0.25rem)] sm:min-w-[calc(25%-0.375rem)] bg-gradient-to-br from-yellow-500 to-yellow-600 rounded-lg shadow-lg p-3 text-white">
          <div className="flex items-center justify-between mb-1">
            <Package size={20} />
            <TrendingUp size={16} className="opacity-70" />
          </div>
          <h3 className="text-xs font-medium opacity-90">Borrowed Gallons</h3>
          <p className="text-xl sm:text-2xl font-bold mt-0.5">
            {formatBorrowedGallons(metrics.borrowedGallons)}
          </p>
        </div>

        {/* Total Amount */}
        <div className="flex-1 min-w-[calc(50%-0.25rem)] sm:min-w-[calc(25%-0.375rem)] bg-gradient-to-br from-purple-500 to-purple-600 rounded-lg shadow-lg p-3 text-white">
          <div className="flex items-center justify-between mb-1">
            <DollarSign size={20} />
            <TrendingUp size={16} className="opacity-70" />
          </div>
          <h3 className="text-xs font-medium opacity-90">Total Amount</h3>
          <p className="text-lg sm:text-xl font-bold mt-0.5">
            Rp {metrics.totalAmount.toLocaleString()}
          </p>
        </div>
      </div>

      {/* Detailed Breakdown */}
      <div className="bg-white rounded-lg shadow p-4">
        <h3 className="font-bold text-gray-800 mb-3 flex items-center gap-2">
          <BarChart size={18} />
          Period Summary
        </h3>
        <div className="space-y-3">
          <div className="flex justify-between items-center py-2 border-b">
            <span className="text-sm text-gray-600">Total Orders Delivered:</span>
            <span className="font-bold text-blue-600">{metrics.deliveredCount} orders</span>
          </div>
          <div className="flex justify-between items-center py-2 border-b">
            <span className="text-sm text-gray-600">Total Gallons Delivered:</span>
            <span className="font-bold text-green-600">{metrics.gallonsDelivered} gallons</span>
          </div>
          <div className="flex justify-between items-center py-2 border-b">
            <span className="text-sm text-gray-600">Total Borrowed Gallons:</span>
            <span className={`font-bold ${getBorrowedGallonsColor(metrics.borrowedGallons)}`}>
              {formatBorrowedGallons(metrics.borrowedGallons)} gallons
            </span>
          </div>
          <div className="flex justify-between items-center py-2">
            <span className="text-sm text-gray-600">Total Revenue:</span>
            <span className="font-bold text-purple-600">
              Rp {metrics.totalAmount.toLocaleString()}
            </span>
          </div>
        </div>
      </div>

      {/* Info Note */}
      <div className="mt-4 bg-blue-50 border border-blue-200 rounded-lg p-3">
        <p className="text-xs text-blue-800">
          <strong>Note:</strong> These metrics show data for delivered orders only. 
          {selectedPeriod === "custom" && " Custom date range applied."}
          {selectedPeriod === "today" && " Showing today's data."}
          {selectedPeriod === "week" && " Showing last 7 days."}
          {selectedPeriod === "month" && " Showing last 30 days."}
          {selectedPeriod === "all" && " Showing all-time data since inception."}
        </p>
      </div>
    </div>
  );
}
