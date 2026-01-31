// components/finance/SettlementBilling.tsx - Settlement Management & Bill Generation
import React, { useState, useEffect } from "react";
import { supabase } from "../../supabaseClient";
import {
  Calendar,
  FileText,
  Download,
  DollarSign,
  CheckCircle,
  Clock,
  Search,
} from "lucide-react";
import jsPDF from "jspdf";
import "jspdf-autotable";
import { getPaymentStatusStyle } from "../../utils/pdfHelpers";
import { formatDateJakarta, formatDateLocalizedJakarta } from "../../utils/timezoneHelpers";

interface Customer {
  id: string;
  name: string;
  address: string;
  whatsapp: string;
  branch: string;
  payment_term: "daily" | "weekly" | "biweekly" | "monthly";
}

interface Order {
  id: string;
  customer_id: string;
  customer_name: string;
  customer_address: string;
  branch: string;
  total_amount: number;
  payment_status: "paid" | "unpaid";
  delivery_date: string;
  created_at: string;
  order_items?: OrderItem[];
}

interface OrderItem {
  id: string;
  product: string;
  quantity: number;
  unit_price: number;
  discount: number;
}

interface Settlement {
  customer_id: string;
  customer_name: string;
  customer_address: string;
  branch: string;
  payment_term: string;
  orders: Order[];
  total_amount: number;
  paid_amount: number;
  unpaid_amount: number;
  period_start: string;
  period_end: string;
}

interface Props {
  currentUser: { id: string; branch: string };
  orders: Order[];
  customers: Customer[];
}

export default function SettlementBilling({ currentUser, orders, customers }: Props) {
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [selectedPeriod, setSelectedPeriod] = useState<"week" | "biweekly" | "month">("week");
  const [searchTerm, setSearchTerm] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(false);

  useEffect(() => {
    generateSettlements();
  }, [selectedPeriod, orders, customers]);

  const getDateRange = (): { start: Date; end: Date } => {
    const now = new Date();
    
    if (selectedPeriod === "week") {
      // Last week: Previous Monday to Sunday
      const today = now.getDay(); // 0 = Sunday, 1 = Monday, etc.
      const lastMonday = new Date(now);
      const daysToLastMonday = today === 0 ? 8 : today + 6; // If Sunday, go back 8 days; else go back to last Monday
      lastMonday.setDate(now.getDate() - daysToLastMonday);
      lastMonday.setHours(0, 0, 0, 0);
      
      const lastSunday = new Date(lastMonday);
      lastSunday.setDate(lastMonday.getDate() + 6);
      lastSunday.setHours(23, 59, 59, 999);
      
      return { start: lastMonday, end: lastSunday };
    } else if (selectedPeriod === "biweekly") {
      // Bi-weekly: 1st-15th or 16th-end of month
      const currentDay = now.getDate();
      
      if (currentDay >= 16) {
        // We're in second half, so bill for first half (1st-15th)
        const start = new Date(now.getFullYear(), now.getMonth(), 1);
        const end = new Date(now.getFullYear(), now.getMonth(), 15);
        end.setHours(23, 59, 59, 999);
        return { start, end };
      } else {
        // We're in first half, so bill for second half of last month (16th-end)
        const start = new Date(now.getFullYear(), now.getMonth() - 1, 16);
        const end = new Date(now.getFullYear(), now.getMonth(), 0); // Last day of previous month
        end.setHours(23, 59, 59, 999);
        return { start, end };
      }
    } else {
      // Last month: 1st to last day of previous month
      const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const lastDayOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0);
      lastDayOfLastMonth.setHours(23, 59, 59, 999);
      
      return { start: lastMonth, end: lastDayOfLastMonth };
    }
  };

  const generateSettlements = (): void => {
    setLoading(true);
    const { start, end } = getDateRange();

    // Group orders by customer
    const customerOrders: Record<string, Order[]> = {};
    
    orders.forEach((order) => {
      const orderDate = formatDateJakarta(order.delivery_date);
       if (orderDate >= start.toISOString().split('T')[0] && orderDate <= end.toISOString().split('T')[0]) {
        if (!customerOrders[order.customer_id]) {
          customerOrders[order.customer_id] = [];
        }
        customerOrders[order.customer_id].push(order);
      }
    });

    // Create settlements
    const newSettlements: Settlement[] = [];
    
    Object.entries(customerOrders).forEach(([customerId, custOrders]) => {
      const customer = customers.find((c) => c.id === customerId);
      if (!customer) return;

      // Only include weekly/monthly customers (exclude daily)
      if (customer.payment_term === "daily" || !customer.payment_term) {
        return;
      }

      const totalAmount = custOrders.reduce((sum, o) => sum + o.total_amount, 0);
      const paidAmount = custOrders
        .filter((o) => o.payment_status === "paid")
        .reduce((sum, o) => sum + o.total_amount, 0);
      const unpaidAmount = totalAmount - paidAmount;

      newSettlements.push({
        customer_id: customerId,
        customer_name: customer.name,
        customer_address: customer.address,
        branch: customer.branch,
        payment_term: customer.payment_term,
        orders: custOrders,
        total_amount: totalAmount,
        paid_amount: paidAmount,
        unpaid_amount: unpaidAmount,
        period_start: start.toISOString().split("T")[0],
        period_end: end.toISOString().split("T")[0],
      });
    });

    setSettlements(newSettlements);
    setLoading(false);
  };

  const generateBillPDF = async (settlement: Settlement): Promise<void> => {
    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.width;

    // Header
    doc.setFontSize(20);
    doc.setFont("helvetica", "bold");
    doc.text("WATER DEPOT", pageWidth / 2, 20, { align: "center" });
    
    doc.setFontSize(12);
    doc.setFont("helvetica", "normal");
    doc.text(`${settlement.branch} Branch`, pageWidth / 2, 28, { align: "center" });

    // Title
    doc.setFontSize(16);
    doc.setFont("helvetica", "bold");
    doc.text("BILLING STATEMENT", pageWidth / 2, 40, { align: "center" });

    // Customer Info
    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    doc.text(`To: ${settlement.customer_name}`, 20, 55);
    doc.text(`Address: ${settlement.customer_address}`, 20, 62);
    doc.text(
      `Period: ${settlement.period_start} to ${settlement.period_end}`,
      20,
      69
    );
    doc.text(`Bill Date: ${formatDateLocalizedJakarta(new Date())}`, 20, 76);


    // Load order items
    const ordersWithItems = await Promise.all(
      settlement.orders.map(async (order) => {
        const { data: items } = await supabase
          .from("order_items")
          .select("*")
          .eq("order_id", order.id);
        return { ...order, order_items: items || [] };
      })
    );

    // Table data
    const tableData: any[] = [];
    let rowNum = 1;

    ordersWithItems.forEach((order) => {
      // Add order header with payment status
      const statusStyle = getPaymentStatusStyle(order.payment_status);
      tableData.push([
        {
          content: `Order Date: ${formatDateJakarta(order.delivery_date)} - ${statusStyle.text}`,
          colSpan: 5,
           styles: { 
            fontStyle: "bold", 
            fillColor: statusStyle.fillColor,
             textColor: statusStyle.textColor
             },
        },
      ]);

      // Add order items
      order.order_items?.forEach((item) => {
        const itemTotal = (item.unit_price - item.discount) * item.quantity;
        tableData.push([
          rowNum++,
          item.product,
          item.quantity,
          `Rp ${(item.unit_price - item.discount).toLocaleString()}`,
          `Rp ${itemTotal.toLocaleString()}`,
        ]);
      });
    });

    // Generate table
    (doc as any).autoTable({
      startY: 85,
      head: [["#", "Item", "Qty", "Unit Price", "Total"]],
      body: tableData,
      theme: "grid",
      headStyles: { fillColor: [66, 139, 202] },
      styles: { fontSize: 9 },
      columnStyles: {
        0: { cellWidth: 15 },
        1: { cellWidth: 70 },
        2: { cellWidth: 20 },
        3: { cellWidth: 35 },
        4: { cellWidth: 40 },
      },
    });

    // Summary
    const finalY = (doc as any).lastAutoTable.finalY + 10;
    doc.setFontSize(10);
    doc.setFont("helvetica", "bold");
    
    doc.text(`Subtotal:`, pageWidth - 80, finalY);
    doc.text(`Rp ${settlement.total_amount.toLocaleString()}`, pageWidth - 20, finalY, {
      align: "right",
    });

    if (settlement.paid_amount > 0) {
      doc.setTextColor(0, 150, 0);
      doc.text(`Paid:`, pageWidth - 80, finalY + 7);
      doc.text(`- Rp ${settlement.paid_amount.toLocaleString()}`, pageWidth - 20, finalY + 7, {
        align: "right",
      });
    }

    doc.setTextColor(0, 0, 0);
    doc.setFontSize(12);
    doc.setDrawColor(0, 0, 0);
    doc.line(pageWidth - 80, finalY + 12, pageWidth - 20, finalY + 12);
    
    if (settlement.unpaid_amount > 0) {
      doc.setTextColor(200, 0, 0);
      doc.text(`Amount Due:`, pageWidth - 80, finalY + 20);
      doc.text(`Rp ${settlement.unpaid_amount.toLocaleString()}`, pageWidth - 20, finalY + 20, {
        align: "right",
      });
    } else {
      doc.setTextColor(0, 150, 0);
      doc.text(`PAID IN FULL`, pageWidth - 80, finalY + 20);
    }

    // Footer
    doc.setTextColor(0, 0, 0);
    doc.setFontSize(8);
    doc.setFont("helvetica", "italic");
    doc.text(
      "Thank you for your business!",
      pageWidth / 2,
      doc.internal.pageSize.height - 20,
      { align: "center" }
    );
    doc.text(
      `Payment Term: ${settlement.payment_term}`,
      pageWidth / 2,
      doc.internal.pageSize.height - 15,
      { align: "center" }
    );

    // Save PDF
    doc.save(
      `Bill_${settlement.customer_name.replace(/\s+/g, "_")}_${settlement.period_start}_${settlement.period_end}.pdf`
    );
  };

  const filteredSettlements = settlements.filter((s) =>
    s.customer_name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="p-4 max-w-6xl mx-auto space-y-4">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold text-gray-800">Settlement Billing</h2>
          <p className="text-sm text-gray-600 mt-1">
            Manage weekly & monthly customer settlements
          </p>
        </div>
      </div>

      {/* Period Selection */}
      <div className="bg-white rounded-lg shadow p-4">
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex gap-2 flex-wrap">
            <button
              onClick={() => setSelectedPeriod("week")}
              className={`px-4 py-2 rounded-lg font-medium transition ${
                selectedPeriod === "week"
                  ? "bg-blue-600 text-white"
                  : "bg-gray-100 text-gray-700 hover:bg-gray-200"
              }`}
            >
              <Calendar className="inline mr-2" size={16} />
              Last Week (Mon-Sun)
            </button>
            <button
              onClick={() => setSelectedPeriod("biweekly")}
              className={`px-4 py-2 rounded-lg font-medium transition ${
                selectedPeriod === "biweekly"
                  ? "bg-blue-600 text-white"
                  : "bg-gray-100 text-gray-700 hover:bg-gray-200"
              }`}
            >
              <Calendar className="inline mr-2" size={16} />
              Bi-Weekly (1-15 / 16-end)
            </button>
            <button
              onClick={() => setSelectedPeriod("month")}
              className={`px-4 py-2 rounded-lg font-medium transition ${
                selectedPeriod === "month"
                  ? "bg-blue-600 text-white"
                  : "bg-gray-100 text-gray-700 hover:bg-gray-200"
              }`}
            >
              <Calendar className="inline mr-2" size={16} />
              Last Month
            </button>
          </div>

          <div className="flex-1 relative min-w-[200px]">
            <Search
              className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400"
              size={18}
            />
            <input
              type="text"
              placeholder="Search customer..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border rounded-lg"
            />
          </div>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white rounded-lg shadow p-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm text-gray-600">Customers</p>
            <FileText className="text-blue-600" size={20} />
          </div>
          <p className="text-2xl font-bold text-blue-600">
            {filteredSettlements.length}
          </p>
        </div>

        <div className="bg-white rounded-lg shadow p-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm text-gray-600">Total Billed</p>
            <DollarSign className="text-green-600" size={20} />
          </div>
          <p className="text-2xl font-bold text-green-600">
            Rp{" "}
            {filteredSettlements
              .reduce((sum, s) => sum + s.total_amount, 0)
              .toLocaleString()}
          </p>
        </div>

        <div className="bg-white rounded-lg shadow p-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm text-gray-600">Outstanding</p>
            <Clock className="text-red-600" size={20} />
          </div>
          <p className="text-2xl font-bold text-red-600">
            Rp{" "}
            {filteredSettlements
              .reduce((sum, s) => sum + s.unpaid_amount, 0)
              .toLocaleString()}
          </p>
        </div>
      </div>

      {/* Settlements List */}
      <div className="space-y-3">
        {filteredSettlements.length === 0 ? (
          <div className="bg-white p-12 rounded-lg shadow text-center text-gray-500">
            <FileText size={48} className="mx-auto mb-3 text-gray-400" />
            <p className="text-lg font-medium">No settlements found</p>
            <p className="text-sm mt-2">
              No weekly/biweekly/monthly customers with orders in selected period
            </p>
          </div>
        ) : (
          filteredSettlements.map((settlement) => (
            <div
              key={settlement.customer_id}
              className="bg-white rounded-lg shadow-md p-4"
            >
              <div className="flex justify-between items-start mb-3">
                <div>
                  <h3 className="text-lg font-bold">{settlement.customer_name}</h3>
                  <p className="text-sm text-gray-600">{settlement.customer_address}</p>
                  <p className="text-xs text-gray-500 mt-1">
                    {settlement.branch} • {settlement.payment_term}
                  </p>
                </div>
                <span
                  className={`px-3 py-1 rounded-full text-xs font-bold ${
                    settlement.unpaid_amount === 0
                      ? "bg-green-100 text-green-800"
                      : "bg-red-100 text-red-800"
                  }`}
                >
                  {settlement.unpaid_amount === 0 ? "PAID" : "OUTSTANDING"}
                </span>
              </div>

              <div className="grid grid-cols-3 gap-4 mb-4 p-3 bg-gray-50 rounded-lg">
                <div>
                  <p className="text-xs text-gray-600">Orders</p>
                  <p className="text-lg font-bold">{settlement.orders.length}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-600">Total</p>
                  <p className="text-lg font-bold text-gray-900">
                    Rp {settlement.total_amount.toLocaleString()}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-gray-600">Due</p>
                  <p
                    className={`text-lg font-bold ${
                      settlement.unpaid_amount === 0
                        ? "text-green-600"
                        : "text-red-600"
                    }`}
                  >
                    Rp {settlement.unpaid_amount.toLocaleString()}
                  </p>
                </div>
              </div>

              <button
                onClick={() => generateBillPDF(settlement)}
                className="w-full bg-blue-600 text-white py-3 rounded-lg hover:bg-blue-700 font-bold transition flex items-center justify-center gap-2"
              >
                <Download size={20} />
                Generate Bill (PDF)
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

