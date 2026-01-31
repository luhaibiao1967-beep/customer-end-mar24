// App.js - Username-Based Login System
import React, { useState, useEffect } from "react";
import { supabase } from "./supabaseClient";
import {
  Package,
  Truck,
  DollarSign,
  Users,
  Building,
  FileText,
  Map,
  BarChart,
} from "lucide-react";

// Import modules
import SalesOrderPage from "./components/sales/OrderPage";
import SalesDeliveryPage from "./components/sales/DeliveryPage";
import SalesPaymentPage from "./components/sales/PaymentPage";
import SalesCustomerPage from "./components/sales/CustomerPage";
import SalesCustomerBills from "./components/sales/CustomerBills";

import OperatorTripsPage from "./components/operator/TripsPage";
import OperatorOrdersPage from "./components/operator/OrdersPage";
import OperatorDataInsightsPage from "./components/operator/DataInsightsPage";

import FinancePaymentsPage from "./components/finance/PaymentsPage";
import FinanceReportsPage from "./components/finance/ReportsPage";
import FinanceOrdersPage from "./components/finance/OrdersPage";
import FinanceCustomerPaymentTerms from "./components/finance/CustomerPaymentTerms";
import FinanceSettlementBilling from "./components/finance/SettlementBilling";

import AdminBranchesPage from "./components/admin/BranchesPage";
import AdminProductsPage from "./components/admin/ProductsPage";
import AdminUsersPage from "./components/admin/UsersPage";
import AdminReportsPage from "./components/admin/ReportsPage";

export default function WaterDepotApp() {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loginForm, setLoginForm] = useState({
    username: "", // Changed from email to username
    password: "",
  });
  const [currentUser, setCurrentUser] = useState(null);
  const [activePage, setActivePage] = useState("");
  const [language, setLanguage] = useState<"en" | "id">("id"); // Default Indonesian

  // Translations object - MUST BE OUTSIDE useEffect
  const translations = {
    en: {
      title: "VIVIDAQUA",
      subtitle: "SMART DELIVERY PORTAL",
      login: "LOGIN",
      username: "Username",
      password: "Password",
      loginButton: "LOGIN",
      loading: "Loading...",
      signingIn: "Signing in...",
      poweredBy: "POWERED BY VIVIDAQUA",
      demoAccounts: "Demo Accounts:",
      note: "Note: Login with username, not email",
    },
    id: {
      title: "VIVIDAQUA",
      subtitle: "PORTAL PENGIRIMAN CERDAS",
      login: "MASUK",
      username: "Nama Pengguna",
      password: "Kata Sandi",
      loginButton: "MASUK",
      loading: "Memuat...",
      signingIn: "Masuk...",
      poweredBy: "DIDUKUNG OLEH VIVIDAQUA",
      demoAccounts: "Akun Demo:",
      note: "Catatan: Login dengan nama pengguna, bukan email",
    },
  };

  // Data states
  const [branches, setBranches] = useState([]);
  const [products, setProducts] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [orders, setOrders] = useState([]);
  const [users, setUsers] = useState([]);

  // Check for existing session
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if (session) {
        loadUserProfile(session.user.id);
      }
      setLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      if (session) {
        loadUserProfile(session.user.id);
      } else {
        setCurrentUser(null);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  // Set default page when user logs in
  useEffect(() => {
    if (currentUser && !activePage) {
      const defaultPages = {
        sales: "orders",
        operator: "trips",
        finance: "payments",
        admin: "branches",
      };
      setActivePage(defaultPages[currentUser.role] || "orders");
    }
  }, [currentUser, activePage]);

  const loadUserProfile = async (userId) => {
    try {
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", userId)
        .single();

      if (error) {
        console.error("Error loading profile:", error);
        alert("Profile not found. Please contact admin.");
        await supabase.auth.signOut();
        return;
      }

      if (data) {
        setCurrentUser(data);
        loadAllData(data.branch);
      }
    } catch (error) {
      console.error("Error:", error);
      alert("Error loading profile: " + error.message);
    }
  };

  const loadAllData = async (userBranch) => {
    loadBranches();
    loadProducts();
    loadCustomers(userBranch);
    loadOrders(userBranch);
    loadUsers(userBranch);
  };

  const loadBranches = async () => {
    const { data, error } = await supabase
      .from("branches")
      .select("*")
      .order("name");
    if (error) console.error("Error loading branches:", error);
    if (data) setBranches(data);
  };

  const loadProducts = async () => {
    const { data, error } = await supabase
      .from("products")
      .select("*")
      .order("name");
    if (error) console.error("Error loading products:", error);
    if (data) setProducts(data);
  };

  const loadCustomers = async (userBranch) => {
    let query = supabase.from("customers").select("*").order("name");
    if (userBranch && userBranch !== "All") {
      query = query.eq("branch", userBranch);
    }
    const { data, error } = await query;
    if (error) console.error("Error loading customers:", error);
    if (data) setCustomers(data);
  };

  const loadOrders = async (userBranch) => {
    try {
      let query = supabase
        .from("orders")
        .select("*")
        .order("created_at", { ascending: false });

      if (userBranch && userBranch !== "All") {
        query = query.eq("branch", userBranch);
      }

      const { data, error } = await query;

      if (error) {
        console.error("Error loading orders:", error);
        return;
      }

      if (data) setOrders(data);
    } catch (error) {
      console.error("Catch error loading orders:", error);
    }
  };

  const loadUsers = async (userBranch) => {
    let query = supabase.from("profiles").select("*").order("name");
    if (userBranch && userBranch !== "All") {
      query = query.eq("branch", userBranch);
    }
    const { data, error } = await query;
    if (error) console.error("Error loading users:", error);
    if (data) setUsers(data);
  };

  // USERNAME-BASED LOGIN
  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);

    try {
      // Step 1: Find user by username to get their email
      const { data: profileData, error: profileError } = await supabase
        .from("profiles")
        .select("email, username, name, status")
        .eq("username", loginForm.username.toLowerCase().trim())
        .single();

      if (profileError || !profileData) {
        alert("Username not found. Please check your username and try again.");
        setLoading(false);
        return;
      }

      // Check if user is active
      if (profileData.status === "inactive") {
        alert("Your account has been deactivated. Please contact admin.");
        setLoading(false);
        return;
      }

      // Step 2: Login with the email from profile
      const { error: authError } = await supabase.auth.signInWithPassword({
        email: profileData.email,
        password: loginForm.password,
      });

      if (authError) {
        console.error("Auth error:", authError);
        if (authError.message.includes("Invalid login credentials")) {
          alert("Incorrect password. Please try again.");
        } else if (authError.message.includes("Email not confirmed")) {
          alert("Account not confirmed. Please contact admin.");
        } else {
          alert("Login failed: " + authError.message);
        }
      }
      // User will be logged in automatically via onAuthStateChange
    } catch (error) {
      console.error("Login error:", error);
      alert("Login error: " + error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    setCurrentUser(null);
    setActivePage("");
  };

  // Bottom navigation configurations
  const navigationConfig = {
    sales: [
      { id: "orders", label: "Orders", icon: Package },
      { id: "delivery", label: "Delivery", icon: Truck },
      { id: "payment", label: "Payment", icon: DollarSign },
      { id: "customers", label: "Customers", icon: Users },
      { id: "bills", label: "Bills", icon: FileText },
    ],
    operator: [
      { id: "trips", label: "Trips", icon: Truck },
      { id: "orders", label: "Orders", icon: Package },
      { id: "data-insights", label: "Data", icon: BarChart },
      { id: "map", label: "Map", icon: Map },
    ],
    finance: [
      { id: "payments", label: "Payments", icon: DollarSign },
      { id: "settlements", label: "Settlements", icon: FileText },
      { id: "reports", label: "Reports", icon: BarChart },
      { id: "orders", label: "Orders", icon: Package },
      { id: "payment-terms", label: "Payment Terms", icon: DollarSign },
    ],
    admin: [
      { id: "branches", label: "Branches", icon: Building },
      { id: "products", label: "Products", icon: Package },
      { id: "users", label: "Users", icon: Users },
      { id: "reports", label: "Reports", icon: FileText },
    ],
  };

  const renderPage = () => {
    const commonProps = {
      currentUser,
      branches,
      products,
      customers,
      orders,
      users,
      loadBranches,
      loadProducts,
      loadCustomers,
      loadOrders,
      loadUsers,
    };

    // Sales pages
    if (currentUser.role === "sales") {
      switch (activePage) {
        case "orders":
          return <SalesOrderPage {...commonProps} />;
        case "delivery":
          return <SalesDeliveryPage {...commonProps} />;
        case "payment":
          return <SalesPaymentPage {...commonProps} />;
        case "customers":
          return <SalesCustomerPage {...commonProps} />;
        case "bills":
          return <SalesCustomerBills {...commonProps} />;
        default:
          return <SalesOrderPage {...commonProps} />;
      }
    }

    // Operator pages
    if (currentUser.role === "operator") {
      switch (activePage) {
        case "trips":
          return <OperatorTripsPage {...commonProps} />;
        case "orders":
          return <OperatorOrdersPage {...commonProps} />;
        case "data-insights":
          return <OperatorDataInsightsPage {...commonProps} />;
        case "map":
          return (
            <div className="p-4 text-center text-gray-600">
              Map view coming soon...
            </div>
          );
        default:
          return <OperatorTripsPage {...commonProps} />;
      }
    }

    // Finance pages
    if (currentUser.role === "finance") {
      switch (activePage) {
        case "payments":
          return <FinancePaymentsPage {...commonProps} />;
        case "settlements":
          return <FinanceSettlementBilling {...commonProps} />;
        case "reports":
          return <FinanceReportsPage {...commonProps} />;
        case "orders":
          return <FinanceOrdersPage {...commonProps} />;
        case "payment-terms":
          return <FinanceCustomerPaymentTerms {...commonProps} />;
        default:
          return <FinancePaymentsPage {...commonProps} />;
      }
    }

    // Admin pages
    if (currentUser.role === "admin") {
      switch (activePage) {
        case "branches":
          return <AdminBranchesPage {...commonProps} />;
        case "products":
          return <AdminProductsPage {...commonProps} />;
        case "users":
          return <AdminUsersPage {...commonProps} />;
        case "reports":
          return <AdminReportsPage {...commonProps} />;
        default:
          return <AdminBranchesPage {...commonProps} />;
      }
    }

    return <div className="p-4">Invalid role</div>;
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  if (!session || !currentUser) {
    const t = translations[language]; // Get current language translations

    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-500 via-blue-600 to-blue-700 flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          {/* Logo and Title */}
          <div className="text-center mb-8">
            <div className="bg-white w-24 h-24 rounded-full flex items-center justify-center mx-auto mb-6 shadow-xl">
              <Truck size={50} className="text-blue-600" />
            </div>
            <h1 className="text-4xl font-bold text-white mb-2">{t.title}</h1>
            <p className="text-blue-100 text-sm tracking-widest font-medium">
              {t.subtitle}
            </p>
          </div>

          {/* Login Form Card */}
          <div className="bg-white rounded-3xl shadow-2xl p-8">
            {/* Language Toggle */}
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-2xl font-bold text-gray-800">{t.login}</h2>
              <div className="flex gap-2">
                <button
                  onClick={() => setLanguage("en")}
                  className={`px-4 py-1.5 rounded-lg text-sm font-bold transition ${
                    language === "en"
                      ? "bg-blue-600 text-white"
                      : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                  }`}
                >
                  EN
                </button>
                <button
                  onClick={() => setLanguage("id")}
                  className={`px-4 py-1.5 rounded-lg text-sm font-bold transition ${
                    language === "id"
                      ? "bg-blue-600 text-white"
                      : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                  }`}
                >
                  ID
                </button>
              </div>
            </div>

            {/* Login Form */}
            <form onSubmit={handleLogin} className="space-y-5">
              <div>
                <div className="relative">
                  <Users
                    size={20}
                    className="absolute left-4 top-1/2 transform -translate-y-1/2 text-gray-400"
                  />
                  <input
                    type="text"
                    value={loginForm.username}
                    onChange={(e) =>
                      setLoginForm({ ...loginForm, username: e.target.value })
                    }
                    placeholder={t.username}
                    required
                    autoComplete="username"
                    className="w-full pl-12 pr-4 py-4 border-2 border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:outline-none transition text-gray-700 placeholder-gray-400"
                  />
                </div>
              </div>

              <div>
                <div className="relative">
                  <svg
                    className="absolute left-4 top-1/2 transform -translate-y-1/2 text-gray-400"
                    width="20"
                    height="20"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <rect
                      x="3"
                      y="11"
                      width="18"
                      height="11"
                      rx="2"
                      ry="2"
                    ></rect>
                    <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
                  </svg>
                  <input
                    type="password"
                    value={loginForm.password}
                    onChange={(e) =>
                      setLoginForm({ ...loginForm, password: e.target.value })
                    }
                    placeholder={t.password}
                    required
                    autoComplete="current-password"
                    className="w-full pl-12 pr-4 py-4 border-2 border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:outline-none transition text-gray-700 placeholder-gray-400"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full bg-blue-600 text-white py-4 rounded-xl font-bold text-lg hover:bg-blue-700 transition shadow-lg hover:shadow-xl disabled:bg-gray-400 disabled:cursor-not-allowed"
              >
                {loading ? t.signingIn : t.loginButton}
              </button>
            </form>

            {/* Powered By */}
            <p className="text-center text-xs text-gray-400 mt-6 tracking-wider">
              {t.poweredBy}
            </p>
          </div>

          {/* Demo Accounts - Optional, can be removed in production */}
          <div className="mt-6 bg-white/10 backdrop-blur-sm rounded-2xl p-4">
            <p className="text-xs font-semibold text-white mb-2">
              {t.demoAccounts}
            </p>
            <div className="space-y-1 text-xs text-blue-100">
              <p>
                <strong>Admin:</strong> admin / admin123
              </p>
              <p>
                <strong>Sales:</strong> sales1 / sales123
              </p>
              <p>
                <strong>Operator:</strong> operator1 / operator123
              </p>
              <p>
                <strong>Finance:</strong> finance1 / finance123
              </p>
            </div>
            <p className="text-xs text-blue-200 mt-3 italic">{t.note}</p>
          </div>
        </div>
      </div>
    );
  }

  const currentNavigation = navigationConfig[currentUser.role] || [];

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Header */}
      <div className="bg-blue-600 text-white p-4 shadow-lg flex-shrink-0">
        <div className="flex justify-between items-center max-w-6xl mx-auto">
          <div>
            <h1 className="text-xl font-bold">Water Depot</h1>
            <p className="text-sm text-blue-100 capitalize">
              {currentUser.role}
            </p>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-right text-sm">
              <p className="font-medium">{currentUser.name}</p>
              <p className="text-blue-100">{currentUser.branch}</p>
            </div>
            <button
              onClick={handleLogout}
              className="bg-blue-700 hover:bg-blue-800 px-4 py-2 rounded-lg text-sm transition"
            >
              Logout
            </button>
          </div>
        </div>
      </div>

      {/* Main Content - Scrollable */}
      <div className="flex-1 overflow-y-auto pb-20">
        <div className="max-w-6xl mx-auto">{renderPage()}</div>
      </div>

      {/* Bottom Navigation Bar - Fixed */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t-2 border-gray-200 shadow-lg flex-shrink-0 z-50">
        <div className="max-w-6xl mx-auto flex justify-around">
          {currentNavigation.map((nav) => (
            <button
              key={nav.id}
              onClick={() => setActivePage(nav.id)}
              className={`flex-1 flex flex-col items-center justify-center py-3 transition-colors ${
                activePage === nav.id
                  ? "text-blue-600 bg-blue-50"
                  : "text-gray-600 hover:text-blue-600 hover:bg-gray-50"
              }`}
            >
              <nav.icon size={24} className="mb-1" />
              <span className="text-xs font-medium">{nav.label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
