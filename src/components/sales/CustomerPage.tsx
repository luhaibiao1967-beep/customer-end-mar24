// components/sales/CustomerPage.js
import React, { useState } from "react";
import { supabase } from "../../supabaseClient";
import {
  Plus,
  MessageCircle,
  Edit2,
  Trash2,
  X,
  Search,
  Users,
} from "lucide-react";

export default function CustomerPage({
  currentUser,
  customers,
  loadCustomers,
}) {
  const [showForm, setShowForm] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [newCustomer, setNewCustomer] = useState({
    name: "",
    address: "",
    phone: "",
    whatsapp: "",
    discount: 0,
  });

  const handleAdd = async () => {
    if (!newCustomer.name || !newCustomer.address || !newCustomer.whatsapp) {
      alert("Please fill name, address, and WhatsApp");
      return;
    }

    const customerData = {
      ...newCustomer,
      discount: parseInt(newCustomer.discount) || 0,
      branch: currentUser.branch === "All" ? "Jakarta" : currentUser.branch,
      created_by: currentUser.id,
    };

    if (editingCustomer) {
      const { error } = await supabase
        .from("customers")
        .update(customerData)
        .eq("id", editingCustomer.id);

      if (error) {
        alert("Error: " + error.message);
      } else {
        await loadCustomers(currentUser.branch);
        resetForm();
        alert("Customer updated!");
      }
    } else {
      const { error } = await supabase.from("customers").insert([customerData]);

      if (error) {
        alert("Error: " + error.message);
      } else {
        await loadCustomers(currentUser.branch);
        resetForm();
        alert("Customer added!");
      }
    }
  };

  const handleEdit = (customer) => {
    setEditingCustomer(customer);
    setNewCustomer({
      name: customer.name,
      address: customer.address,
      phone: customer.phone || "",
      whatsapp: customer.whatsapp,
      discount: customer.discount || 0,
    });
    setShowForm(true);
  };

  const handleDelete = async (id) => {
    if (!confirm("Delete this customer? This cannot be undone.")) return;

    const { error } = await supabase.from("customers").delete().eq("id", id);

    if (error) {
      alert("Error: " + error.message);
    } else {
      await loadCustomers(currentUser.branch);
      alert("Customer deleted!");
    }
  };

  const resetForm = () => {
    setNewCustomer({
      name: "",
      address: "",
      phone: "",
      whatsapp: "",
      discount: 0,
    });
    setEditingCustomer(null);
    setShowForm(false);
  };

  // Filter customers by search
  const filteredCustomers = customers.filter(
    (c) =>
      c.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      c.address.toLowerCase().includes(searchTerm.toLowerCase()) ||
      c.whatsapp.includes(searchTerm)
  );

  return (
    <div className="p-4 space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold">Customer Management</h2>
        <button
          onClick={() => {
            resetForm();
            setShowForm(true);
          }}
          className="bg-blue-600 text-white px-6 py-3 rounded-lg flex items-center gap-2 hover:bg-blue-700 transition shadow-lg text-lg font-medium"
        >
          <Plus size={24} />
          Add Customer
        </button>
      </div>

      {/* Summary Card */}
      <div className="bg-gradient-to-r from-purple-500 to-purple-600 text-white rounded-lg shadow-lg p-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-purple-100 mb-1">Total Customers</p>
            <p className="text-4xl font-bold">{customers.length}</p>
          </div>
          <Users size={64} className="text-purple-200 opacity-50" />
        </div>
      </div>

      {/* Search Bar */}
      <div className="relative">
        <Search
          className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400"
          size={20}
        />
        <input
          type="text"
          placeholder="Search by name, address, or WhatsApp..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full pl-10 pr-4 py-3 border-2 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none text-base"
        />
      </div>

      {/* Customer Form Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg p-6 max-w-lg w-full max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-xl font-bold">
                {editingCustomer ? "Edit Customer" : "Add New Customer"}
              </h3>
              <button
                onClick={resetForm}
                className="text-gray-500 hover:text-gray-700"
              >
                <X size={28} />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Customer Name *
                </label>
                <input
                  type="text"
                  placeholder="Enter customer name"
                  value={newCustomer.name}
                  onChange={(e) =>
                    setNewCustomer({ ...newCustomer, name: e.target.value })
                  }
                  className="w-full px-4 py-3 border-2 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Address *
                </label>
                <textarea
                  placeholder="Enter full address"
                  value={newCustomer.address}
                  onChange={(e) =>
                    setNewCustomer({ ...newCustomer, address: e.target.value })
                  }
                  className="w-full px-4 py-3 border-2 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  rows={3}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  WhatsApp Number *
                </label>
                <input
                  type="text"
                  placeholder="e.g., 6281234567890"
                  value={newCustomer.whatsapp}
                  onChange={(e) =>
                    setNewCustomer({ ...newCustomer, whatsapp: e.target.value })
                  }
                  className="w-full px-4 py-3 border-2 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Include country code (62 for Indonesia)
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Phone Number (Optional)
                </label>
                <input
                  type="text"
                  placeholder="e.g., 021-1234567"
                  value={newCustomer.phone}
                  onChange={(e) =>
                    setNewCustomer({ ...newCustomer, phone: e.target.value })
                  }
                  className="w-full px-4 py-3 border-2 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Discount per Unit (Rp)
                </label>
                <input
                  type="number"
                  placeholder="0"
                  value={newCustomer.discount}
                  onChange={(e) =>
                    setNewCustomer({ ...newCustomer, discount: e.target.value })
                  }
                  className="w-full px-4 py-3 border-2 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Discount applies only to Refill products
                </p>
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  onClick={handleAdd}
                  className="flex-1 bg-green-600 text-white py-3 rounded-lg hover:bg-green-700 font-bold text-lg transition"
                >
                  {editingCustomer ? "Update Customer" : "Add Customer"}
                </button>
                <button
                  onClick={resetForm}
                  className="flex-1 bg-gray-300 text-gray-700 py-3 rounded-lg hover:bg-gray-400 font-bold text-lg transition"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Customers List */}
      <div className="space-y-3">
        {filteredCustomers.length === 0 ? (
          <div className="bg-white p-12 rounded-lg shadow text-center text-gray-500">
            <Users size={48} className="mx-auto mb-3 text-gray-400" />
            <p className="text-lg font-medium">
              {searchTerm ? "No customers found" : "No customers yet"}
            </p>
            <p className="text-sm mt-2">
              {searchTerm
                ? "Try a different search term"
                : 'Click "Add Customer" to create your first customer'}
            </p>
          </div>
        ) : (
          filteredCustomers.map((customer) => (
            <div
              key={customer.id}
              className="bg-white rounded-lg shadow-md overflow-hidden border-l-4 border-purple-500"
            >
              <div className="p-4">
                <div className="flex justify-between items-start mb-3">
                  <div className="flex-1">
                    <h3 className="text-xl font-bold text-gray-900">
                      {customer.name}
                    </h3>
                    <p className="text-sm text-gray-600 mt-1">
                      {customer.address}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleEdit(customer)}
                      className="bg-blue-100 text-blue-700 p-2 rounded-lg hover:bg-blue-200 transition"
                      title="Edit"
                    >
                      <Edit2 size={18} />
                    </button>
                    <button
                      onClick={() => handleDelete(customer.id)}
                      className="bg-red-100 text-red-700 p-2 rounded-lg hover:bg-red-200 transition"
                      title="Delete"
                    >
                      <Trash2 size={18} />
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 mb-3">
                  <div className="bg-gray-50 p-3 rounded-lg">
                    <p className="text-xs text-gray-600 mb-1">WhatsApp</p>
                    <p className="text-sm font-medium text-gray-900">
                      {customer.whatsapp}
                    </p>
                  </div>
                  {customer.phone && (
                    <div className="bg-gray-50 p-3 rounded-lg">
                      <p className="text-xs text-gray-600 mb-1">Phone</p>
                      <p className="text-sm font-medium text-gray-900">
                        {customer.phone}
                      </p>
                    </div>
                  )}
                </div>

                {customer.discount > 0 && (
                  <div className="bg-orange-50 border border-orange-200 rounded-lg p-3 mb-3">
                    <p className="text-sm font-medium text-orange-800">
                      💰 Discount: Rp {customer.discount.toLocaleString()} per
                      unit (Refill only)
                    </p>
                  </div>
                )}

                <a
                  href={`https://wa.me/${
                    customer.whatsapp
                  }?text=${encodeURIComponent(
                    `Halo ${customer.name}, terima kasih sudah menjadi pelanggan setia kami!`
                  )}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full bg-green-600 text-white py-3 rounded-lg hover:bg-green-700 transition flex items-center justify-center gap-2 font-medium"
                >
                  <MessageCircle size={20} />
                  Send WhatsApp Message
                </a>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Quick Stats */}
      {filteredCustomers.length > 0 && (
        <div className="bg-white rounded-lg shadow-lg p-4">
          <h3 className="font-bold text-lg mb-3">Customer Statistics</h3>
          <div className="grid grid-cols-2 gap-4">
            <div className="text-center p-3 bg-blue-50 rounded-lg">
              <p className="text-2xl font-bold text-blue-600">
                {filteredCustomers.length}
              </p>
              <p className="text-xs text-gray-600">Total Customers</p>
            </div>
            <div className="text-center p-3 bg-orange-50 rounded-lg">
              <p className="text-2xl font-bold text-orange-600">
                {filteredCustomers.filter((c) => c.discount > 0).length}
              </p>
              <p className="text-xs text-gray-600">With Discounts</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
