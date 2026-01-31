// components/admin/ReportsPage.js - Admin Reports
import React from "react";
import { FileText } from "lucide-react";

export default function AdminReportsPage({ currentUser }) {
  return (
    <div className="p-4 max-w-6xl mx-auto">
      <div className="bg-white rounded-lg shadow-md p-8 text-center">
        <FileText size={64} className="mx-auto mb-4 text-gray-300" />
        <h2 className="text-2xl font-bold text-gray-800 mb-2">Admin Reports</h2>
        <p className="text-gray-600 mb-4">
          Comprehensive reports and analytics coming soon...
        </p>
        <p className="text-sm text-gray-500">This page will include:</p>
        <ul className="text-sm text-gray-500 mt-2 space-y-1">
          <li>• Sales reports by branch</li>
          <li>• Financial analytics</li>
          <li>• User activity logs</li>
          <li>• Performance metrics</li>
        </ul>
      </div>
    </div>
  );
}
