// components/sales/CustomerBills.tsx - Sales can generate bills for customers
import React, { useState, useEffect } from "react";
import { supabase } from "../../supabaseClient";
import {
  FileText,
  Download,
  Search,
  Calendar,
  DollarSign,
  X,
} from "lucide-react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { getPaymentStatusStyle } from "../../utils/pdfHelpers";
import { formatDateJakarta, formatDateLocalizedJakarta } from "../../utils/timezoneHelpers";

// Extend jsPDF type to include autoTable
declare module "jspdf" {
  interface jsPDF {
    autoTable: (options: any) => jsPDF;
    lastAutoTable: any;
  }
}

interface Customer {
  id: string;
  name: string;
  address: string;
  whatsapp: string;
  branch: string;
  payment_term: string;
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
}

interface OrderItem {
  id: string;
  product: string;
  quantity: number;
  unit_price: number;
  discount: number;
}

interface Props {
  currentUser: { id: string; branch: string };
  orders: Order[];
  customers: Customer[];
}

export default function SalesCustomerBills({ currentUser, orders, customers }: Props) {
  const [searchTerm, setSearchTerm] = useState<string>("");
  const [showAutocomplete, setShowAutocomplete] = useState<boolean>(false);
  const [filteredSuggestions, setFilteredSuggestions] = useState<Customer[]>([]);
  const [dateRange, setDateRange] = useState({
    from: new Date(new Date().setDate(new Date().getDate() - 30))
      .toISOString()
      .split("T")[0],
    to: new Date().toISOString().split("T")[0],
  });
  const [generating, setGenerating] = useState<boolean>(false);

  const filteredCustomers = customers.filter((c) =>
    c.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // Handle search input change
  const handleSearchChange = (value: string) => {
    setSearchTerm(value);
    
    if (value.trim() === "") {
      setShowAutocomplete(false);
      setFilteredSuggestions([]);
    } else {
      const matches = customers.filter((c) =>
        c.name.toLowerCase().includes(value.toLowerCase())
      );
      setFilteredSuggestions(matches.slice(0, 5)); // Show max 5 suggestions
      setShowAutocomplete(matches.length > 0);
    }
  };

  // Handle selecting a suggestion
  const handleSelectSuggestion = (customer: Customer) => {
    setSearchTerm(customer.name);
    setShowAutocomplete(false);
    setFilteredSuggestions([]);
  };

  // Clear search
  const handleClearSearch = () => {
    setSearchTerm("");
    setShowAutocomplete(false);
    setFilteredSuggestions([]);
  };

  const getCustomerOrders = (customerId: string) => {
    return orders.filter((order) => {
      const orderDate = formatDateJakarta(order.delivery_date);
      const fromDate = dateRange.from;
      const toDate = dateRange.to;
      return (
        order.customer_id === customerId &&
        orderDate >= fromDate &&
        orderDate <= toDate
      );
    });
  };

  const getCustomerTotal = (customerId: string) => {
    const customerOrders = getCustomerOrders(customerId);
    return customerOrders.reduce((sum, o) => sum + o.total_amount, 0);
  };

  const getCustomerPaid = (customerId: string) => {
    const customerOrders = getCustomerOrders(customerId);
    return customerOrders
      .filter((o) => o.payment_status === "paid")
      .reduce((sum, o) => sum + o.total_amount, 0);
  };

  const getCustomerUnpaid = (customerId: string) => {
    const customerOrders = getCustomerOrders(customerId);
    return customerOrders
      .filter((o) => o.payment_status === "unpaid")
      .reduce((sum, o) => sum + o.total_amount, 0);
  };

  const generateBillPDF = async (customer: Customer): Promise<void> => {
    console.log("Starting PDF generation for:", customer.name);
    setGenerating(true);

    try {
      const customerOrders = getCustomerOrders(customer.id);
      console.log("Customer orders found:", customerOrders.length);

      if (customerOrders.length === 0) {
        alert("No orders found for this customer in the selected date range.");
        setGenerating(false);
        return;
      }

      console.log("Creating PDF...");
      const doc = new jsPDF();
      const pageWidth = doc.internal.pageSize.width;

      // Header
      doc.setFontSize(20);
      doc.setFont("helvetica", "bold");
      doc.text("PT FAMINDO VIVIDAQUA AIR MINUM", pageWidth / 2, 20, { align: "center" });

      doc.setFontSize(12);
      doc.setFont("helvetica", "normal");
      doc.text(`${customer.branch} Branch`, pageWidth / 2, 28, {
        align: "center",
      });

      // Title
      doc.setFontSize(16);
      doc.setFont("helvetica", "bold");
      doc.text("BILLING STATEMENT", pageWidth / 2, 40, { align: "center" });

      // Customer Info
      doc.setFontSize(10);
      doc.setFont("helvetica", "normal");
      doc.text(`To: ${customer.name}`, 20, 55);
      doc.text(`Address: ${customer.address}`, 20, 62);
      doc.text(`Period: ${dateRange.from} to ${dateRange.to}`, 20, 69);
       doc.text(`Bill Date: ${formatDateLocalizedJakarta(new Date())}`, 20, 76);
      doc.text(`Payment Term: ${customer.payment_term || "daily"}`, 20, 83);

      console.log("Loading order items from database...");
      // Load order items
      const ordersWithItems = await Promise.all(
        customerOrders.map(async (order) => {
          const { data: items, error } = await supabase
            .from("order_items")
            .select("*")
            .eq("order_id", order.id);
          
          if (error) {
            console.error("Error loading items for order:", order.id, error);
          }
          
          return { ...order, order_items: items || [] };
        })
      );

      console.log("Orders with items loaded:", ordersWithItems.length);

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
        order.order_items?.forEach((item: OrderItem) => {
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

      console.log("Generating table with", tableData.length, "rows");

      // Generate table using autoTable
      autoTable(doc, {
        startY: 90,
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
      const totalAmount = getCustomerTotal(customer.id);
      const paidAmount = getCustomerPaid(customer.id);
      const unpaidAmount = getCustomerUnpaid(customer.id);

      doc.setFontSize(10);
      doc.setFont("helvetica", "bold");

      doc.text(`Subtotal:`, pageWidth - 80, finalY);
      doc.text(`Rp ${totalAmount.toLocaleString()}`, pageWidth - 20, finalY, {
        align: "right",
      });

      if (paidAmount > 0) {
        doc.setTextColor(0, 150, 0);
        doc.text(`Paid:`, pageWidth - 80, finalY + 7);
        doc.text(`- Rp ${paidAmount.toLocaleString()}`, pageWidth - 20, finalY + 7, {
          align: "right",
        });
      }

      doc.setTextColor(0, 0, 0);
      doc.setFontSize(12);
      doc.setDrawColor(0, 0, 0);
      doc.line(pageWidth - 80, finalY + 12, pageWidth - 20, finalY + 12);

      if (unpaidAmount > 0) {
        doc.setTextColor(200, 0, 0);
        doc.text(`Amount Due:`, pageWidth - 80, finalY + 20);
        doc.text(`Rp ${unpaidAmount.toLocaleString()}`, pageWidth - 20, finalY + 20, {
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

      // Save PDF
      const filename = `Bill_${customer.name.replace(/\s+/g, "_")}_${dateRange.from}_${dateRange.to}.pdf`;
      console.log("Saving PDF as:", filename);
      
      doc.save(filename);
      
      console.log("PDF generated successfully!");
      alert("Bill generated successfully!");
    } catch (error: any) {
      console.error("Error generating bill:", error);
      alert("Error generating bill: " + error.message);
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="p-4 max-w-6xl mx-auto space-y-4">
      <div>
        <h2 className="text-2xl font-bold text-gray-800">Customer Bills</h2>
        <p className="text-sm text-gray-600 mt-1">
          Generate billing statements for customers
        </p>
      </div>

      {/* Date Range */}
      <div className="bg-white rounded-lg shadow p-4">
        <div className="flex items-center gap-4 flex-wrap">
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

      {/* Search with Autocomplete */}
      <div className="relative">
        <Search
          className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 z-10"
          size={20}
        />
        <input
          type="text"
          placeholder="Search customer by name..."
          value={searchTerm}
          onChange={(e) => handleSearchChange(e.target.value)}
          onFocus={() => {
            if (searchTerm && filteredSuggestions.length > 0) {
              setShowAutocomplete(true);
            }
          }}
          className="w-full pl-10 pr-10 py-3 border-2 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
        />
        {searchTerm && (
          <button
            onClick={handleClearSearch}
            className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
          >
            <X size={20} />
          </button>
        )}

        {/* Autocomplete Dropdown */}
        {showAutocomplete && filteredSuggestions.length > 0 && (
          <div className="absolute z-20 w-full mt-1 bg-white border-2 border-blue-500 rounded-lg shadow-lg max-h-60 overflow-y-auto">
            {filteredSuggestions.map((customer) => {
              const customerOrders = getCustomerOrders(customer.id);
              const totalAmount = getCustomerTotal(customer.id);
              
              return (
                <div
                  key={customer.id}
                  onClick={() => handleSelectSuggestion(customer)}
                  className="px-4 py-3 hover:bg-blue-50 cursor-pointer border-b last:border-b-0 transition"
                >
                  <div className="flex justify-between items-start">
                    <div>
                      <p className="font-bold text-gray-900">{customer.name}</p>
                      <p className="text-sm text-gray-600">{customer.address}</p>
                      <p className="text-xs text-gray-500 mt-1">
                        {customer.branch} • {customer.payment_term || "daily"}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-gray-600">{customerOrders.length} orders</p>
                      <p className="text-sm font-bold text-green-600">
                        Rp {totalAmount.toLocaleString()}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Customer List */}
      <div className="space-y-3">
        {filteredCustomers.length === 0 ? (
          <div className="bg-white p-12 rounded-lg shadow text-center text-gray-500">
            <FileText size={48} className="mx-auto mb-3 text-gray-400" />
            <p className="text-lg font-medium">No customers found</p>
          </div>
        ) : (
          filteredCustomers.map((customer) => {
            const customerOrders = getCustomerOrders(customer.id);
            const totalAmount = getCustomerTotal(customer.id);
            const paidAmount = getCustomerPaid(customer.id);
            const unpaidAmount = getCustomerUnpaid(customer.id);

            return (
              <div
                key={customer.id}
                className="bg-white rounded-lg shadow-md p-4"
              >
                <div className="flex justify-between items-start mb-3">
                  <div>
                    <h3 className="text-lg font-bold">{customer.name}</h3>
                    <p className="text-sm text-gray-600">{customer.address}</p>
                    <p className="text-xs text-gray-500 mt-1">
                      {customer.branch} • Payment: {customer.payment_term || "daily"}
                    </p>
                  </div>
                  <span
                    className={`px-3 py-1 rounded-full text-xs font-bold ${
                      unpaidAmount === 0
                        ? "bg-green-100 text-green-800"
                        : "bg-orange-100 text-orange-800"
                    }`}
                  >
                    {customerOrders.length} orders
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-4 mb-4 p-3 bg-gray-50 rounded-lg">
                  <div>
                    <p className="text-xs text-gray-600">Total</p>
                    <p className="text-lg font-bold text-gray-900">
                      Rp {totalAmount.toLocaleString()}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-600">Paid</p>
                    <p className="text-lg font-bold text-green-600">
                      Rp {paidAmount.toLocaleString()}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-600">Unpaid</p>
                    <p className="text-lg font-bold text-red-600">
                      Rp {unpaidAmount.toLocaleString()}
                    </p>
                  </div>
                </div>

                <button
                  onClick={() => generateBillPDF(customer)}
                  disabled={customerOrders.length === 0 || generating}
                  className="w-full bg-blue-600 text-white py-3 rounded-lg hover:bg-blue-700 font-bold transition flex items-center justify-center gap-2 disabled:bg-gray-400 disabled:cursor-not-allowed"
                >
                  {generating ? (
                    <>
                      <div className="animate-spin rounded-full h-5 w-5 border-2 border-white border-t-transparent"></div>
                      Generating...
                    </>
                  ) : (
                    <>
                      <Download size={20} />
                      Generate Bill (PDF)
                    </>
                  )}
                </button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
