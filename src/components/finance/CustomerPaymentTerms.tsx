// components/admin/CustomerPaymentTerms.tsx - Manage Customer Payment Terms
import React, { useState, useEffect } from "react";
import { supabase } from "../../supabaseClient";
import { Calendar, Edit2, Save, X } from "lucide-react";

interface Customer {
  id: string;
  name: string;
  address: string;
  whatsapp: string;
  discount: number;
  branch: string;
  payment_term: "daily" | "weekly" | "biweekly" | "monthly";
}

interface Props {
  currentUser: { id: string; branch: string };
  customers: Customer[];
  loadCustomers: (branch: string) => Promise<void>;
}

export default function CustomerPaymentTerms({ currentUser, customers, loadCustomers }: Props) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editData, setEditData] = useState<Partial<Customer>>({});

  const handleEdit = (customer: Customer): void => {
    setEditingId(customer.id);
    setEditData({
      payment_term: customer.payment_term || "daily",
    });
  };

  const handleSave = async (customerId: string): Promise<void> => {
    try {
      console.log("Saving payment term:", {
        customerId,
        newTerm: editData.payment_term,
      });

      const { data, error } = await supabase
        .from("customers")
        .update({ payment_term: editData.payment_term })
        .eq("id", customerId)
        .select(); // Return updated data

      if (error) {
        console.error("Update error:", error);
        alert("Error: " + error.message);
        return;
      }

      console.log("Update successful, updated data:", data);

      // Reload customers to get updated data
      await loadCustomers(currentUser.branch);
      
      console.log("Customers reloaded");

      setEditingId(null);
      setEditData({});
      alert("Payment terms updated!");
    } catch (err: any) {
      console.error("Save error:", err);
      alert("Error: " + err.message);
    }
  };

  const getPaymentTermInfo = (term: string): { label: string; description: string } => {
    switch (term) {
      case "weekly":
        return {
          label: "Weekly",
          description: "Bill sent every Monday for last week",
        };
      case "biweekly":
        return {
          label: "Bi-Weekly",
          description: "Bill sent on 1st & 16th of month",
        };
      case "monthly":
        return {
          label: "Monthly",
          description: "Bill sent on 1st of month for last month",
        };
      default:
        return {
          label: "Daily",
          description: "Pay on delivery (immediate)",
        };
    }
  };

  return (
    <div className="bg-white rounded-lg shadow-md p-6">
      <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
        <Calendar className="text-blue-600" />
        Customer Payment Terms
      </h3>
      <p className="text-sm text-gray-600 mb-4">
        Set billing schedules: Daily (immediate), Weekly (bill every Monday), Monthly (bill on 1st)
      </p>

      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-600">
                Customer
              </th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-600">
                Branch
              </th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-600">
                Payment Term
              </th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-600">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {customers.map((customer) => {
              const termInfo = getPaymentTermInfo(customer.payment_term || "daily");
              return (
                <tr key={customer.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <p className="font-medium text-sm">{customer.name}</p>
                    <p className="text-xs text-gray-500">{customer.address}</p>
                  </td>
                  <td className="px-4 py-3 text-sm">{customer.branch}</td>
                  <td className="px-4 py-3">
                    {editingId === customer.id ? (
                      <select
                        value={editData.payment_term || "daily"}
                        onChange={(e) =>
                          setEditData({
                            ...editData,
                            payment_term: e.target.value as any,
                          })
                        }
                        className="w-full px-3 py-2 border rounded-lg text-sm"
                      >
                        <option value="daily">Daily (Immediate)</option>
                        <option value="weekly">Weekly (Every Monday)</option>
                        <option value="biweekly">Bi-Weekly (1st & 16th)</option>
                        <option value="monthly">Monthly (1st of Month)</option>
                      </select>
                    ) : (
                      <span className="inline-block px-3 py-1 bg-blue-100 text-blue-800 rounded-full text-xs font-medium">
                        {termInfo.label}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {editingId === customer.id ? (
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleSave(customer.id)}
                          className="bg-green-600 text-white px-3 py-1 rounded text-sm hover:bg-green-700 flex items-center gap-1"
                        >
                          <Save size={14} />
                          Save
                        </button>
                        <button
                          onClick={() => {
                            setEditingId(null);
                            setEditData({});
                          }}
                          className="bg-gray-300 text-gray-700 px-3 py-1 rounded text-sm hover:bg-gray-400"
                        >
                          <X size={14} />
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => handleEdit(customer)}
                        className="bg-blue-100 text-blue-700 px-3 py-1 rounded text-sm hover:bg-blue-200 flex items-center gap-1"
                      >
                        <Edit2 size={14} />
                        Edit
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Info Box */}
      <div className="mt-6 p-4 bg-blue-50 border-2 border-blue-200 rounded-lg">
        <h4 className="font-bold text-sm text-blue-900 mb-2">Billing Schedule:</h4>
        <ul className="space-y-1 text-xs text-blue-800">
          <li>• <strong>Daily:</strong> Customer pays immediately on delivery</li>
          <li>• <strong>Weekly:</strong> Bill sent every Monday covering previous week (Mon-Sun)</li>
          <li>• <strong>Bi-Weekly:</strong> Bill sent on 1st & 16th of month covering previous period</li>
          <li className="ml-6">- 1st of month: covers 16th-end of last month</li>
          <li className="ml-6">- 16th of month: covers 1st-15th of current month</li>
          <li>• <strong>Monthly:</strong> Bill sent on 1st of month covering entire previous month</li>
        </ul>
      </div>
    </div>
  );
}
