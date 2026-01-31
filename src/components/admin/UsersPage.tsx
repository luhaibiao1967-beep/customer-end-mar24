// components/admin/UsersPage.js - User Management
import React, { useState, useEffect } from "react";
import { supabase } from "../../supabaseClient";
import { Plus, Edit2, Trash2, Users, Mail, Shield } from "lucide-react";

export default function AdminUsersPage({ currentUser }) {
  const [users, setUsers] = useState([]);
  const [branches, setBranches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    password: "",
    role: "sales",
    branch: "PIK 2",
    status: "active",
  });

  useEffect(() => {
    loadUsers();
    loadBranches();
  }, []);

  const loadBranches = async () => {
    const { data } = await supabase
      .from("branches")
      .select("*")
      .eq("status", "active")
      .order("name");
    if (data) setBranches(data);
  };

  const loadUsers = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("profiles")
      .select("*")
      .order("name");

    if (error) {
      console.error("Error loading users:", error);
      alert("Error loading users: " + error.message);
    } else {
      setUsers(data || []);
    }
    setLoading(false);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (
      !formData.name ||
      !formData.email ||
      !formData.role ||
      !formData.branch
    ) {
      alert("Please fill all required fields");
      return;
    }

    // Email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(formData.email)) {
      alert("Please enter a valid email address");
      return;
    }

    setLoading(true);

    if (editingUser) {
      // Update existing user (profile only)
      const { error } = await supabase
        .from("profiles")
        .update({
          name: formData.name,
          email: formData.email,
          role: formData.role,
          branch: formData.branch,
          status: formData.status,
          updated_at: new Date().toISOString(),
        })
        .eq("id", editingUser.id);

      if (error) {
        console.error("Error updating user:", error);
        alert("Error updating user: " + error.message);
      } else {
        alert("User updated successfully!");
        resetForm();
        loadUsers();
      }
    } else {
      // Create new user - auth + profile
      if (!formData.password || formData.password.length < 6) {
        alert("Password must be at least 6 characters");
        setLoading(false);
        return;
      }

      // Step 1: Create auth user
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email: formData.email,
        password: formData.password,
        options: {
          data: {
            name: formData.name,
          },
        },
      });

      if (authError) {
        console.error("Error creating auth user:", authError);
        alert("Error creating user account: " + authError.message);
        setLoading(false);
        return;
      }

      // Step 2: Create profile
      if (authData.user) {
        const { error: profileError } = await supabase.from("profiles").insert([
          {
            id: authData.user.id,
            email: formData.email,
            name: formData.name,
            role: formData.role,
            branch: formData.branch,
            status: formData.status,
          },
        ]);

        if (profileError) {
          console.error("Error creating profile:", profileError);
          alert(
            "User account created but profile failed: " + profileError.message
          );
        } else {
          alert(
            `User created successfully!\n\nEmail: ${formData.email}\nPassword: ${formData.password}\n\nPlease save these credentials!`
          );
          resetForm();
          loadUsers();
        }
      }
    }

    setLoading(false);
  };

  const handleEdit = (user) => {
    setEditingUser(user);
    setFormData({
      name: user.name,
      email: user.email,
      password: "", // Don't show password
      role: user.role,
      branch: user.branch,
      status: user.status,
    });
    setShowForm(true);
  };

  const handleDelete = async (user) => {
    if (user.id === currentUser.id) {
      alert("You cannot delete your own account!");
      return;
    }

    if (
      !confirm(
        `Are you sure you want to delete user "${user.name}"?\n\nThis will:\n- Delete their profile\n- Delete their auth account\n- This cannot be undone!`
      )
    ) {
      return;
    }

    setLoading(true);

    // Delete profile first
    const { error: profileError } = await supabase
      .from("profiles")
      .delete()
      .eq("id", user.id);

    if (profileError) {
      console.error("Error deleting profile:", profileError);
      alert("Error deleting user profile: " + profileError.message);
      setLoading(false);
      return;
    }

    // Note: Deleting auth user requires admin API - for now just delete profile
    alert(
      "User profile deleted. Note: Auth account still exists and needs to be deleted from Supabase Dashboard → Authentication → Users"
    );
    loadUsers();
    setLoading(false);
  };

  const toggleStatus = async (user) => {
    if (user.id === currentUser.id) {
      alert("You cannot deactivate your own account!");
      return;
    }

    const newStatus = user.status === "active" ? "inactive" : "active";

    const { error } = await supabase
      .from("profiles")
      .update({ status: newStatus, updated_at: new Date().toISOString() })
      .eq("id", user.id);

    if (error) {
      console.error("Error updating status:", error);
      alert("Error updating status: " + error.message);
    } else {
      loadUsers();
    }
  };

  const resetForm = () => {
    setFormData({
      name: "",
      email: "",
      password: "",
      role: "sales",
      branch: "PIK 2",
      status: "active",
    });
    setEditingUser(null);
    setShowForm(false);
  };

  const getRoleColor = (role) => {
    const colors = {
      admin: "bg-purple-100 text-purple-800",
      sales: "bg-blue-100 text-blue-800",
      operator: "bg-green-100 text-green-800",
      finance: "bg-orange-100 text-orange-800",
    };
    return colors[role] || "bg-gray-100 text-gray-800";
  };

  if (loading && users.length === 0) {
    return (
      <div className="p-4 text-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
        <p className="text-gray-600 mt-2">Loading users...</p>
      </div>
    );
  }

  return (
    <div className="p-4 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex justify-between items-center mb-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
            <Users className="text-blue-600" />
            User Management
          </h2>
          <p className="text-sm text-gray-600 mt-1">
            Manage system users and permissions
          </p>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="bg-blue-600 text-white px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-blue-700 transition"
        >
          <Plus size={20} />
          Add User
        </button>
      </div>

      {/* Form */}
      {showForm && (
        <div className="bg-white rounded-lg shadow-md p-6 mb-6 border-2 border-blue-200">
          <h3 className="text-lg font-bold mb-4">
            {editingUser ? "Edit User" : "Add New User"}
          </h3>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Full Name *
              </label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) =>
                  setFormData({ ...formData, name: e.target.value })
                }
                placeholder="e.g., Budi Sales"
                required
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Email *
              </label>
              <input
                type="email"
                value={formData.email}
                onChange={(e) =>
                  setFormData({ ...formData, email: e.target.value })
                }
                placeholder="e.g., budi@depot.com"
                required
                disabled={editingUser !== null}
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none disabled:bg-gray-100"
              />
              {editingUser && (
                <p className="text-xs text-gray-500 mt-1">
                  Email cannot be changed after creation
                </p>
              )}
            </div>

            {!editingUser && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Password *
                </label>
                <input
                  type="password"
                  value={formData.password}
                  onChange={(e) =>
                    setFormData({ ...formData, password: e.target.value })
                  }
                  placeholder="Minimum 6 characters"
                  required={!editingUser}
                  minLength={6}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Save this password - it cannot be retrieved later!
                </p>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Role *
                </label>
                <select
                  value={formData.role}
                  onChange={(e) =>
                    setFormData({ ...formData, role: e.target.value })
                  }
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
                >
                  <option value="sales">Sales</option>
                  <option value="operator">Operator</option>
                  <option value="finance">Finance</option>
                  <option value="admin">Admin</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Branch *
                </label>
                <select
                  value={formData.branch}
                  onChange={(e) =>
                    setFormData({ ...formData, branch: e.target.value })
                  }
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
                >
                  <option value="All">All Branches</option>
                  {branches.map((branch) => (
                    <option key={branch.id} value={branch.name}>
                      {branch.name}
                    </option>
                  ))}
                </select>
              </div>
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
                  : editingUser
                  ? "Update User"
                  : "Create User"}
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

      {/* User List */}
      <div className="bg-white rounded-lg shadow-md overflow-hidden">
        <div className="p-4 bg-gray-50 border-b">
          <h3 className="font-semibold text-gray-700">
            All Users ({users.length})
          </h3>
        </div>

        {users.length === 0 ? (
          <div className="p-8 text-center text-gray-500">
            <Users size={48} className="mx-auto mb-3 text-gray-300" />
            <p className="font-medium">No users yet</p>
            <p className="text-sm">
              Click "Add User" to create your first user
            </p>
          </div>
        ) : (
          <div className="divide-y">
            {users.map((user) => (
              <div key={user.id} className="p-4 hover:bg-gray-50 transition">
                <div className="flex justify-between items-start">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <h4 className="font-bold text-lg text-gray-800">
                        {user.name}
                      </h4>
                      <span
                        className={`px-2 py-1 rounded-full text-xs font-medium ${getRoleColor(
                          user.role
                        )}`}
                      >
                        {user.role}
                      </span>
                      <button
                        onClick={() => toggleStatus(user)}
                        disabled={user.id === currentUser.id}
                        className={`px-3 py-1 rounded-full text-xs font-medium transition ${
                          user.status === "active"
                            ? "bg-green-100 text-green-800 hover:bg-green-200"
                            : "bg-gray-100 text-gray-800 hover:bg-gray-200"
                        } disabled:opacity-50 disabled:cursor-not-allowed`}
                      >
                        {user.status}
                      </button>
                      {user.id === currentUser.id && (
                        <span className="px-2 py-1 bg-yellow-100 text-yellow-800 text-xs font-medium rounded">
                          You
                        </span>
                      )}
                    </div>
                    <div className="space-y-1 text-sm text-gray-600">
                      <p className="flex items-center gap-2">
                        <Mail size={14} />
                        {user.email}
                      </p>
                      <p className="flex items-center gap-2">
                        <Shield size={14} />
                        Branch: {user.branch}
                      </p>
                    </div>
                    {user.created_at && (
                      <p className="text-xs text-gray-400 mt-2">
                        Created:{" "}
                        {new Date(user.created_at).toLocaleDateString()}
                      </p>
                    )}
                  </div>

                  <div className="flex gap-2 ml-4">
                    <button
                      onClick={() => handleEdit(user)}
                      className="bg-blue-100 text-blue-700 p-2 rounded-lg hover:bg-blue-200 transition"
                      title="Edit"
                    >
                      <Edit2 size={18} />
                    </button>
                    <button
                      onClick={() => handleDelete(user)}
                      disabled={user.id === currentUser.id}
                      className="bg-red-100 text-red-700 p-2 rounded-lg hover:bg-red-200 transition disabled:opacity-50 disabled:cursor-not-allowed"
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
