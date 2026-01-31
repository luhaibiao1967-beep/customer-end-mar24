// components/admin/BranchesPage.js - Branch Management
import React, { useState, useEffect } from "react";
import { supabase } from "../../supabaseClient";
import { Plus, Edit2, Trash2, Building } from "lucide-react";

export default function AdminBranchesPage({ currentUser }) {
  const [branches, setBranches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingBranch, setEditingBranch] = useState(null);
  const [formData, setFormData] = useState({
    name: "",
    address: "",
    phone: "",
    status: "active",
  });

  useEffect(() => {
    loadBranches();
  }, []);

  const loadBranches = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("branches")
      .select("*")
      .order("name");

    if (error) {
      console.error("Error loading branches:", error);
      alert("Error loading branches: " + error.message);
    } else {
      setBranches(data || []);
    }
    setLoading(false);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!formData.name || !formData.address || !formData.phone) {
      alert("Please fill all required fields");
      return;
    }

    setLoading(true);

    if (editingBranch) {
      // Update existing branch
      const { error } = await supabase
        .from("branches")
        .update({
          name: formData.name,
          address: formData.address,
          phone: formData.phone,
          status: formData.status,
          updated_at: new Date().toISOString(),
        })
        .eq("id", editingBranch.id);

      if (error) {
        console.error("Error updating branch:", error);
        alert("Error updating branch: " + error.message);
      } else {
        alert("Branch updated successfully!");
        resetForm();
        loadBranches();
      }
    } else {
      // Create new branch
      const { error } = await supabase.from("branches").insert([
        {
          name: formData.name,
          address: formData.address,
          phone: formData.phone,
          status: formData.status,
        },
      ]);

      if (error) {
        console.error("Error creating branch:", error);
        alert("Error creating branch: " + error.message);
      } else {
        alert("Branch created successfully!");
        resetForm();
        loadBranches();
      }
    }

    setLoading(false);
  };

  const handleEdit = (branch) => {
    setEditingBranch(branch);
    setFormData({
      name: branch.name,
      address: branch.address,
      phone: branch.phone,
      status: branch.status,
    });
    setShowForm(true);
  };

  const handleDelete = async (branch) => {
    if (
      !confirm(
        `Are you sure you want to delete "${branch.name}"? This cannot be undone.`
      )
    ) {
      return;
    }

    setLoading(true);

    const { error } = await supabase
      .from("branches")
      .delete()
      .eq("id", branch.id);

    if (error) {
      console.error("Error deleting branch:", error);
      alert("Error deleting branch: " + error.message);
    } else {
      alert("Branch deleted successfully!");
      loadBranches();
    }

    setLoading(false);
  };

  const toggleStatus = async (branch) => {
    const newStatus = branch.status === "active" ? "inactive" : "active";

    const { error } = await supabase
      .from("branches")
      .update({ status: newStatus, updated_at: new Date().toISOString() })
      .eq("id", branch.id);

    if (error) {
      console.error("Error updating status:", error);
      alert("Error updating status: " + error.message);
    } else {
      loadBranches();
    }
  };

  const resetForm = () => {
    setFormData({
      name: "",
      address: "",
      phone: "",
      status: "active",
    });
    setEditingBranch(null);
    setShowForm(false);
  };

  if (loading && branches.length === 0) {
    return (
      <div className="p-4 text-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
        <p className="text-gray-600 mt-2">Loading branches...</p>
      </div>
    );
  }

  return (
    <div className="p-4 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex justify-between items-center mb-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
            <Building className="text-blue-600" />
            Branch Management
          </h2>
          <p className="text-sm text-gray-600 mt-1">
            Manage your depot branches
          </p>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="bg-blue-600 text-white px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-blue-700 transition"
        >
          <Plus size={20} />
          Add Branch
        </button>
      </div>

      {/* Form */}
      {showForm && (
        <div className="bg-white rounded-lg shadow-md p-6 mb-6 border-2 border-blue-200">
          <h3 className="text-lg font-bold mb-4">
            {editingBranch ? "Edit Branch" : "Add New Branch"}
          </h3>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Branch Name *
              </label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) =>
                  setFormData({ ...formData, name: e.target.value })
                }
                placeholder="e.g., Jakarta"
                required
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Address *
              </label>
              <textarea
                value={formData.address}
                onChange={(e) =>
                  setFormData({ ...formData, address: e.target.value })
                }
                placeholder="e.g., Jl. Sudirman No. 123, Jakarta"
                required
                rows={2}
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Phone Number *
              </label>
              <input
                type="text"
                value={formData.phone}
                onChange={(e) =>
                  setFormData({ ...formData, phone: e.target.value })
                }
                placeholder="e.g., 021-1234567"
                required
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Status
              </label>
              <select
                value={formData.status}
                onChange={(e) =>
                  setFormData({ ...formData, status: e.target.value })
                }
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
              >
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </div>

            <div className="flex gap-2">
              <button
                type="submit"
                disabled={loading}
                className="flex-1 bg-green-600 text-white py-2 rounded-lg hover:bg-green-700 transition disabled:bg-gray-400"
              >
                {loading
                  ? "Saving..."
                  : editingBranch
                  ? "Update Branch"
                  : "Create Branch"}
              </button>
              <button
                type="button"
                onClick={resetForm}
                className="flex-1 bg-gray-300 text-gray-700 py-2 rounded-lg hover:bg-gray-400 transition"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Branch List */}
      <div className="bg-white rounded-lg shadow-md overflow-hidden">
        <div className="p-4 bg-gray-50 border-b">
          <h3 className="font-semibold text-gray-700">
            All Branches ({branches.length})
          </h3>
        </div>

        {branches.length === 0 ? (
          <div className="p-8 text-center text-gray-500">
            <Building size={48} className="mx-auto mb-3 text-gray-300" />
            <p className="font-medium">No branches yet</p>
            <p className="text-sm">
              Click "Add Branch" to create your first branch
            </p>
          </div>
        ) : (
          <div className="divide-y">
            {branches.map((branch) => (
              <div key={branch.id} className="p-4 hover:bg-gray-50 transition">
                <div className="flex justify-between items-start">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <h4 className="font-bold text-lg text-gray-800">
                        {branch.name}
                      </h4>
                      <button
                        onClick={() => toggleStatus(branch)}
                        className={`px-3 py-1 rounded-full text-xs font-medium transition ${
                          branch.status === "active"
                            ? "bg-green-100 text-green-800 hover:bg-green-200"
                            : "bg-gray-100 text-gray-800 hover:bg-gray-200"
                        }`}
                      >
                        {branch.status}
                      </button>
                    </div>
                    <p className="text-sm text-gray-600 mb-1">
                      <span className="font-medium">Address:</span>{" "}
                      {branch.address}
                    </p>
                    <p className="text-sm text-gray-600">
                      <span className="font-medium">Phone:</span> {branch.phone}
                    </p>
                    {branch.created_at && (
                      <p className="text-xs text-gray-400 mt-2">
                        Created:{" "}
                        {new Date(branch.created_at).toLocaleDateString()}
                      </p>
                    )}
                  </div>

                  <div className="flex gap-2 ml-4">
                    <button
                      onClick={() => handleEdit(branch)}
                      className="bg-blue-100 text-blue-700 p-2 rounded-lg hover:bg-blue-200 transition"
                      title="Edit"
                    >
                      <Edit2 size={18} />
                    </button>
                    <button
                      onClick={() => handleDelete(branch)}
                      className="bg-red-100 text-red-700 p-2 rounded-lg hover:bg-red-200 transition"
                      title="Delete"
                    >
                      <Trash2 size={18} />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
