// components/admin/ProductsPage.js - Product Management
import React, { useState, useEffect } from "react";
import { supabase } from "../../supabaseClient";
import { Plus, Edit2, Trash2, Package } from "lucide-react";

export default function AdminProductsPage({ currentUser }) {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingProduct, setEditingProduct] = useState(null);
  const [formData, setFormData] = useState({
    name: "",
    price: "",
    unit: "gallon",
    is_refill: false,
    status: "active",
  });

  useEffect(() => {
    loadProducts();
  }, []);

  const loadProducts = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("products")
      .select("*")
      .order("name");

    if (error) {
      console.error("Error loading products:", error);
      alert("Error loading products: " + error.message);
    } else {
      setProducts(data || []);
    }
    setLoading(false);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!formData.name || !formData.price || !formData.unit) {
      alert("Please fill all required fields");
      return;
    }

    const price = parseInt(formData.price);
    if (isNaN(price) || price <= 0) {
      alert("Please enter a valid price");
      return;
    }

    setLoading(true);

    if (editingProduct) {
      // Update existing product
      const { error } = await supabase
        .from("products")
        .update({
          name: formData.name,
          price: price,
          unit: formData.unit,
          is_refill: formData.is_refill,
          status: formData.status,
          updated_at: new Date().toISOString(),
        })
        .eq("id", editingProduct.id);

      if (error) {
        console.error("Error updating product:", error);
        alert("Error updating product: " + error.message);
      } else {
        alert("Product updated successfully!");
        resetForm();
        loadProducts();
      }
    } else {
      // Create new product
      const { error } = await supabase.from("products").insert([
        {
          name: formData.name,
          price: price,
          unit: formData.unit,
          is_refill: formData.is_refill,
          status: formData.status,
        },
      ]);

      if (error) {
        console.error("Error creating product:", error);
        alert("Error creating product: " + error.message);
      } else {
        alert("Product created successfully!");
        resetForm();
        loadProducts();
      }
    }

    setLoading(false);
  };

  const handleEdit = (product) => {
    setEditingProduct(product);
    setFormData({
      name: product.name,
      price: product.price.toString(),
      unit: product.unit,
      is_refill: product.is_refill,
      status: product.status,
    });
    setShowForm(true);
  };

  const handleDelete = async (product) => {
    if (
      !confirm(
        `Are you sure you want to delete "${product.name}"? This cannot be undone.`
      )
    ) {
      return;
    }

    setLoading(true);

    const { error } = await supabase
      .from("products")
      .delete()
      .eq("id", product.id);

    if (error) {
      console.error("Error deleting product:", error);
      alert("Error deleting product: " + error.message);
    } else {
      alert("Product deleted successfully!");
      loadProducts();
    }

    setLoading(false);
  };

  const toggleStatus = async (product) => {
    const newStatus = product.status === "active" ? "inactive" : "active";

    const { error } = await supabase
      .from("products")
      .update({ status: newStatus, updated_at: new Date().toISOString() })
      .eq("id", product.id);

    if (error) {
      console.error("Error updating status:", error);
      alert("Error updating status: " + error.message);
    } else {
      loadProducts();
    }
  };

  const resetForm = () => {
    setFormData({
      name: "",
      price: "",
      unit: "gallon",
      is_refill: false,
      status: "active",
    });
    setEditingProduct(null);
    setShowForm(false);
  };

  if (loading && products.length === 0) {
    return (
      <div className="p-4 text-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
        <p className="text-gray-600 mt-2">Loading products...</p>
      </div>
    );
  }

  return (
    <div className="p-4 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex justify-between items-center mb-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
            <Package className="text-blue-600" />
            Product Management
          </h2>
          <p className="text-sm text-gray-600 mt-1">
            Manage your product catalog
          </p>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="bg-blue-600 text-white px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-blue-700 transition"
        >
          <Plus size={20} />
          Add Product
        </button>
      </div>

      {/* Form */}
      {showForm && (
        <div className="bg-white rounded-lg shadow-md p-6 mb-6 border-2 border-blue-200">
          <h3 className="text-lg font-bold mb-4">
            {editingProduct ? "Edit Product" : "Add New Product"}
          </h3>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Product Name *
              </label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) =>
                  setFormData({ ...formData, name: e.target.value })
                }
                placeholder="e.g., Gallon 19L Refill"
                required
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Price (Rp) *
                </label>
                <input
                  type="number"
                  value={formData.price}
                  onChange={(e) =>
                    setFormData({ ...formData, price: e.target.value })
                  }
                  placeholder="e.g., 10000"
                  required
                  min="0"
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Unit *
                </label>
                <select
                  value={formData.unit}
                  onChange={(e) =>
                    setFormData({ ...formData, unit: e.target.value })
                  }
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
                >
                  <option value="gallon">Gallon</option>
                  <option value="botol">Botol</option>
                  <option value="box">Box</option>
                  <option value="pack">Pack</option>
                </select>
              </div>
            </div>

            <div className="flex items-center gap-2 bg-blue-50 p-3 rounded-lg">
              <input
                type="checkbox"
                id="is_refill"
                checked={formData.is_refill}
                onChange={(e) =>
                  setFormData({ ...formData, is_refill: e.target.checked })
                }
                className="w-4 h-4 text-blue-600"
              />
              <label
                htmlFor="is_refill"
                className="text-sm font-medium text-gray-700"
              >
                This is a refill product (customer discount applies)
              </label>
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
                  : editingProduct
                  ? "Update Product"
                  : "Create Product"}
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

      {/* Product List */}
      <div className="bg-white rounded-lg shadow-md overflow-hidden">
        <div className="p-4 bg-gray-50 border-b">
          <h3 className="font-semibold text-gray-700">
            All Products ({products.length})
          </h3>
        </div>

        {products.length === 0 ? (
          <div className="p-8 text-center text-gray-500">
            <Package size={48} className="mx-auto mb-3 text-gray-300" />
            <p className="font-medium">No products yet</p>
            <p className="text-sm">
              Click "Add Product" to create your first product
            </p>
          </div>
        ) : (
          <div className="divide-y">
            {products.map((product) => (
              <div key={product.id} className="p-4 hover:bg-gray-50 transition">
                <div className="flex justify-between items-start">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <h4 className="font-bold text-lg text-gray-800">
                        {product.name}
                      </h4>
                      {product.is_refill && (
                        <span className="px-2 py-1 bg-green-100 text-green-800 text-xs font-medium rounded">
                          Refill
                        </span>
                      )}
                      <button
                        onClick={() => toggleStatus(product)}
                        className={`px-3 py-1 rounded-full text-xs font-medium transition ${
                          product.status === "active"
                            ? "bg-green-100 text-green-800 hover:bg-green-200"
                            : "bg-gray-100 text-gray-800 hover:bg-gray-200"
                        }`}
                      >
                        {product.status}
                      </button>
                    </div>
                    <div className="flex items-center gap-4 text-sm text-gray-600">
                      <p>
                        <span className="font-medium">Price:</span> Rp{" "}
                        {product.price.toLocaleString()} / {product.unit}
                      </p>
                    </div>
                    {product.is_refill && (
                      <p className="text-xs text-orange-600 mt-2">
                        * Customer discounts apply to this product
                      </p>
                    )}
                    {product.created_at && (
                      <p className="text-xs text-gray-400 mt-2">
                        Created:{" "}
                        {new Date(product.created_at).toLocaleDateString()}
                      </p>
                    )}
                  </div>

                  <div className="flex gap-2 ml-4">
                    <button
                      onClick={() => handleEdit(product)}
                      className="bg-blue-100 text-blue-700 p-2 rounded-lg hover:bg-blue-200 transition"
                      title="Edit"
                    >
                      <Edit2 size={18} />
                    </button>
                    <button
                      onClick={() => handleDelete(product)}
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
