// components/operator/TripsPage.js - MOBILE OPTIMIZED + Product Totals Button
import React, { useState, useEffect } from "react";
import { supabase } from "../../supabaseClient";
import { Truck, CheckCircle, MapPin, MessageCircle, Plus, Camera, X, Package, FileText } from "lucide-react";
import { getCurrentJakartaDateString, formatDateLocalizedJakarta } from "../../utils/timezoneHelpers";

export default function OperatorTripsPage({
  currentUser,
  orders,
  loadOrders,
}) {
  const [trips, setTrips] = useState([]);
  const [selectedTrip, setSelectedTrip] = useState(null);
  const [loading, setLoading] = useState(true);
  
  // Delivery confirmation modal states
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [confirmingOrder, setConfirmingOrder] = useState(null);
  const [deliveryPhoto, setDeliveryPhoto] = useState(null);
  const [deliveryPhotoPreview, setDeliveryPhotoPreview] = useState(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  
  // ADDED: Delivery adjustment states
  const [emptyGallonsReturned, setEmptyGallonsReturned] = useState(0);
  const [actualDelivered, setActualDelivered] = useState(0);
  const [deliveryNotes, setDeliveryNotes] = useState("");

  // ADDED: Product totals modal states
  const [showProductTotals, setShowProductTotals] = useState(false);
  const [orderItems, setOrderItems] = useState({});
  
  // ADDED: Receipt modal states
  const [showReceipt, setShowReceipt] = useState(false);
  const [receiptOrder, setReceiptOrder] = useState(null);

  const myOrders = orders.filter(o => {
    if (currentUser.branch === "All") return true;
    return o.branch === currentUser.branch;
  });

  useEffect(() => {
    loadTrips();
  }, []);

  // ADDED: Load order items
  useEffect(() => {
    loadOrderItems();
  }, [orders]);

  const loadOrderItems = async () => {
    if (orders.length === 0) return;

    const { data, error } = await supabase
      .from("order_items")
      .select("*")
      .in("order_id", orders.map(o => o.id));

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

  // ADDED: Calculate product totals for current trip
  const getTripProductTotals = (trip) => {
    const tripOrders = getTripOrders(trip);
    const productTotals = {};

    tripOrders.forEach(order => {
      const items = orderItems[order.id] || [];
      items.forEach(item => {
        if (!productTotals[item.product]) {
          productTotals[item.product] = 0;
        }
        productTotals[item.product] += item.quantity || 0;
      });
    });

    return productTotals;
  };

  // Calculate total gallons for an order (refill + new)
  const getOrderGallons = (orderId) => {
    const items = orderItems[orderId] || [];
    return items
      .filter(item => item.product && item.product.toLowerCase().includes('gallon'))
      .reduce((sum, item) => sum + (item.quantity || 0), 0);
  };

  // Calculate total gallons for a trip (sum of all orders - both scheduled and delivered)
  const getTripGallons = (trip) => {
    if (!trip.order_ids || trip.order_ids.length === 0) return 0;
    
    // Get ALL orders in the trip (scheduled + delivered), not filtered by date
    const allTripOrders = myOrders.filter((order) => 
      trip.order_ids.includes(order.id) && 
      (order.status === 'scheduled' || order.status === 'delivered')
    );
    
    return allTripOrders.reduce((sum, order) => sum + getOrderGallons(order.id), 0);
  };

  const loadTrips = async () => {
    try {
      const { data, error } = await supabase
        .from("trips")
        .select("*")
        .eq("branch", "Shared")
        .order("name", { ascending: true});

      if (error) {
        console.error("Error loading trips:", error);
        setTrips([]);
      } else {
        setTrips(data || []);
        if (data && data.length > 0 && !selectedTrip) {
          setSelectedTrip(data[0].id);
        }
      }
    } catch (error) {
      console.error("Error loading trips:", error);
      setTrips([]);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateNewTrip = async () => {
    const tripNumber = trips.length + 1;
    const newTrip = {
      name: `Trip ${tripNumber}`,
      trip_date: getCurrentJakartaDateString(),
      driver: "",
      branch: "Shared",
      order_ids: [],
      status: "pending"
    };

    const { data, error } = await supabase
      .from("trips")
      .insert([newTrip])
      .select()
      .single();

    if (error) {
      alert("Error: " + error.message);
    } else {
      await loadTrips();
      setSelectedTrip(data.id);
    }
  };

  const getUnassignedOrders = () => {
    return myOrders.filter((order) => {
      const isAssigned = trips.some((trip) =>
        trip.order_ids && trip.order_ids.includes(order.id)
      );
      return order.status === "pending" && !isAssigned;
    });
  };

  const getTripOrders = (trip) => {
    if (!trip.order_ids || trip.order_ids.length === 0) return [];
    
    // Return all orders assigned to the trip without date filtering
    // This includes both scheduled and delivered orders
    return myOrders.filter((order) => 
      trip.order_ids.includes(order.id) && 
      (order.status === 'scheduled' || order.status === 'delivered')
    );
  };

  const getMyOrdersCount = (trip) => {
    if (!trip.order_ids || trip.order_ids.length === 0) return 0;
    return myOrders.filter(o => trip.order_ids.includes(o.id)).length;
  };

  const handleAddOrderToTrip = async (orderId, tripId) => {
    const trip = trips.find(t => t.id === tripId);
    if (!trip) return;

    const newOrderIds = [...(trip.order_ids || []), orderId];

    const { error } = await supabase
      .from("trips")
      .update({ order_ids: newOrderIds, status: "in-progress" })
      .eq("id", tripId);

    if (error) {
      alert("Error: " + error.message);
    } else {
      await supabase
        .from("orders")
        .update({ status: "scheduled" })
        .eq("id", orderId);
      await loadTrips();
      await loadOrders(currentUser.branch);
    }
  };

  const handleRemoveOrderFromTrip = async (orderId, tripId) => {
    const trip = trips.find(t => t.id === tripId);
    if (!trip) return;

    const newOrderIds = (trip.order_ids || []).filter(id => id !== orderId);

    const { error } = await supabase
      .from("trips")
      .update({ order_ids: newOrderIds })
      .eq("id", tripId);

    if (error) {
      alert("Error: " + error.message);
    } else {
      await supabase
        .from("orders")
        .update({ status: "pending" })
        .eq("id", orderId);
      await loadTrips();
      await loadOrders(currentUser.branch);
    }
  };

  const handleUpdateDriver = async (tripId, driverName) => {
    await supabase
      .from("trips")
      .update({ driver: driverName })
      .eq("id", tripId);
    await loadTrips();
  };

  const handleDeleteTrip = async (tripId) => {
    const trip = trips.find(t => t.id === tripId);
    if (!trip) return;

    if (trip.order_ids && trip.order_ids.length > 0) {
      alert("Cannot delete trip with orders. Remove all orders first.");
      return;
    }

    if (!window.confirm(`Delete ${trip.name}?`)) return;

    const { error } = await supabase.from("trips").delete().eq("id", tripId);

    if (error) {
      alert("Error: " + error.message);
    } else {
      await loadTrips();
      setSelectedTrip(null);
    }
  };

  const handleOpenConfirmModal = (order) => {
    setConfirmingOrder(order);
    
    // Calculate total REFILL gallons only from order items
    const items = orderItems[order.id] || [];
    const refillGallons = items
      .filter(item => 
        item.product && 
        item.product.toLowerCase().includes('gallon') && 
        item.is_refill === true
      )
      .reduce((sum, item) => sum + (item.quantity || 0), 0);
    
    // Set defaults - only for refill gallons
    setEmptyGallonsReturned(refillGallons);
    setActualDelivered(refillGallons);
    setDeliveryNotes("");
    setShowConfirmModal(true);
  };

  // Helper function to convert data URL to Blob
  const dataURLtoBlob = (dataURL) => {
    const arr = dataURL.split(',');
    const mime = arr[0].match(/:(.*?);/)[1];
    const bstr = atob(arr[1]);
    let n = bstr.length;
    const u8arr = new Uint8Array(n);
    while (n--) {
      u8arr[n] = bstr.charCodeAt(n);
    }
    return new Blob([u8arr], { type: mime });
  };

  // Compress image to reduce file size to below 300KB
  const compressImage = (file, maxSizeKB = 300) => {
    return new Promise((resolve, reject) => {
      // Validate file type
      if (!file.type.startsWith('image/')) {
        reject(new Error('Invalid file type. Please select an image file.'));
        return;
      }

      const reader = new FileReader();
      
      reader.onerror = () => {
        reject(new Error('Failed to read image file.'));
      };

      reader.onload = (e) => {
        const img = new Image();
        
        img.onerror = () => {
          reject(new Error('Failed to load image. Please try a different file.'));
        };

        img.onload = () => {
          try {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            
            if (!ctx) {
              reject(new Error('Canvas context not available.'));
              return;
            }

            // Calculate new dimensions to maintain aspect ratio
            let width = img.width;
            let height = img.height;
            const maxDimension = 2048; // Maximum width or height

            if (width > maxDimension || height > maxDimension) {
              if (width > height) {
                height = (height * maxDimension) / width;
                width = maxDimension;
              } else {
                width = (width * maxDimension) / height;
                height = maxDimension;
              }
            }

            canvas.width = width;
            canvas.height = height;
            
            // Draw and compress image
            ctx.drawImage(img, 0, 0, width, height);
            
            // Base64 encoding overhead factor: base64 is ~1.37x larger than binary
            const BASE64_OVERHEAD = 1.37;
            const targetSize = maxSizeKB * 1024 * BASE64_OVERHEAD;
            
            // Use binary search for optimal quality to reduce iterations
            let minQuality = 0.1;
            let maxQuality = 0.9;
            let quality = maxQuality;
            let compressedDataUrl = canvas.toDataURL('image/jpeg', quality);
            
            // Binary search for optimal quality
            while (maxQuality - minQuality > 0.05) {
              quality = (minQuality + maxQuality) / 2;
              compressedDataUrl = canvas.toDataURL('image/jpeg', quality);
              
              if (compressedDataUrl.length > targetSize) {
                maxQuality = quality;
              } else {
                minQuality = quality;
              }
            }
            
            // Use the quality that meets the target
            quality = minQuality;
            compressedDataUrl = canvas.toDataURL('image/jpeg', quality);

            // Convert data URL to Blob efficiently
            const blob = dataURLtoBlob(compressedDataUrl);
            const compressedFile = new File([blob], file.name, {
              type: 'image/jpeg',
              lastModified: Date.now()
            });
            
            resolve({ file: compressedFile, preview: compressedDataUrl });
          } catch (err) {
            reject(new Error('Compression failed: ' + err.message));
          }
        };

        img.src = e.target.result;
      };

      reader.readAsDataURL(file);
    });
  };

  const handlePhotoUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    try {
      // Show loading state
      setUploadingPhoto(true);
      
      // Compress the image
      const { file: compressedFile, preview } = await compressImage(file);
      
      // Update state with compressed file
      setDeliveryPhoto(compressedFile);
      setDeliveryPhotoPreview(preview);
      
      setUploadingPhoto(false);
    } catch (error) {
      setUploadingPhoto(false);
      alert(error.message || 'Failed to process image. Please try another file.');
      // Reset file input
      e.target.value = '';
    }
  };

  const handleConfirmDelivery = async () => {
    if (!deliveryPhoto) {
      alert("Please upload delivery photo");
      return;
    }

    setUploadingPhoto(true);

    try {
      const fileName = `delivery-${confirmingOrder.id}-${Date.now()}.jpg`;
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from("delivery-evidence")
        .upload(fileName, deliveryPhoto);

      let deliveryEvidenceUrl = null;
      if (!uploadError) {
        const { data: urlData } = supabase.storage
          .from("delivery-evidence")
          .getPublicUrl(fileName);
        deliveryEvidenceUrl = urlData.publicUrl;
      }

      if (!deliveryEvidenceUrl) {
        deliveryEvidenceUrl = deliveryPhotoPreview;
      }

      // Calculate borrowed gallons (only for refill gallons)
      const borrowedGallons = actualDelivered - emptyGallonsReturned;

      // Recalculate total amount based on actual delivered quantities
      const items = orderItems[confirmingOrder.id] || [];
      let newTotalAmount = 0;
      
      items.forEach(item => {
        if (item.product && item.product.toLowerCase().includes('gallon') && item.is_refill === true) {
          // For refill gallons: use actual delivered quantity
          const finalPrice = item.unit_price - (item.discount || 0);
          newTotalAmount += finalPrice * actualDelivered;
        } else {
          // For non-refill items: use original quantity and price
          const finalPrice = item.unit_price - (item.discount || 0);
          newTotalAmount += finalPrice * item.quantity;
        }
      });

      const { error: updateError } = await supabase
        .from("orders")
        .update({
          status: "delivered",
          delivery_evidence: deliveryEvidenceUrl,
          delivered_date: getCurrentJakartaDateString(),
          empty_gallons_returned: emptyGallonsReturned,
          borrowed_gallons: borrowedGallons,
          delivery_notes: deliveryNotes || null,
          total_amount: newTotalAmount // Update total amount based on actual delivery
        })
        .eq("id", confirmingOrder.id);

      if (updateError) throw updateError;

// ===== FIX: Update order_items table with actual delivered quantities =====
      // Find all refill gallon items that need quantity updates
      const refillItems = items.filter(item => 
        item.product && 
        item.product.toLowerCase().includes('gallon') && 
        item.is_refill === true
      );

      // Update each refill item with the actual delivered quantity
      for (const item of refillItems) {
        const { error: itemUpdateError } = await supabase
          .from("order_items")
          .update({
            quantity: actualDelivered  // Update to actual delivered quantity
          })
          .eq("id", item.id);
        
        if (itemUpdateError) {
          console.error("Error updating order item:", itemUpdateError);
          // Continue with other updates even if one fails
        }
      }
      // ===== END FIX =====

      const currentTrip = trips.find(t => t.id === selectedTrip);
      if (currentTrip) {
        const newOrderIds = currentTrip.order_ids.filter(id => id !== confirmingOrder.id);
        await supabase
          .from("trips")
          .update({
            order_ids: newOrderIds,
            status: newOrderIds.length === 0 ? "completed" : "in-progress"
          })
          .eq("id", selectedTrip);
      }

      await loadTrips();
      await loadOrders(currentUser.branch);
// Reload order items to reflect the updated quantities
      await loadOrderItems();
      
      setShowConfirmModal(false);
      setConfirmingOrder(null);
      setDeliveryPhoto(null);
      setDeliveryPhotoPreview(null);
      setEmptyGallonsReturned(0);
      setActualDelivered(0);
      setDeliveryNotes("");
      alert("Delivery confirmed! Total amount updated to Rp " + newTotalAmount.toLocaleString());
    } catch (error) {
      console.error("Error confirming delivery:", error);
      alert("Error: " + error.message);
    } finally {
      setUploadingPhoto(false);
    }
  };

  if (loading) {
    return (
      <div className="p-4 text-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
        <p className="text-gray-600 mt-2 text-sm">Loading trips...</p>
      </div>
    );
  }

  const currentTrip = trips.find(t => t.id === selectedTrip);
  const unassignedOrders = getUnassignedOrders();

  return (
    <div className="p-3 pb-20 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex justify-between items-center mb-4">
        <div>
          <h2 className="text-lg font-bold text-gray-800 flex items-center gap-2">
            <Truck className="text-blue-600" size={20} />
            Trips
          </h2>
          <p className="text-xs text-gray-600">{currentUser.branch}</p>
        </div>
        <button
          onClick={handleCreateNewTrip}
          className="bg-blue-600 text-white px-3 py-2 rounded-lg hover:bg-blue-700 flex items-center gap-1 text-xs"
        >
          <Plus size={14} />
          New
        </button>
      </div>

      {trips.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-lg shadow">
          <Truck size={48} className="mx-auto mb-3 text-gray-300" />
          <p className="font-bold text-sm mb-1">No trips yet</p>
          <p className="text-xs text-gray-500 mt-1">Click "New" to create Trip 1</p>
        </div>
      ) : (
        <>
          {/* Trip Tabs - Mobile Scrollable */}
          <div className="bg-white shadow-sm rounded-lg overflow-x-auto -mx-3 px-3">
            <div className="flex border-b gap-1">
              {trips.map((trip) => {
                const myCount = getMyOrdersCount(trip);
                return (
                  <button
                    key={trip.id}
                    onClick={() => setSelectedTrip(trip.id)}
                    className={`px-4 py-2 font-medium whitespace-nowrap text-xs ${
                      selectedTrip === trip.id
                        ? "text-blue-600 border-b-2 border-blue-600 bg-blue-50"
                        : "text-gray-600"
                    }`}
                  >
                    <div className="flex items-center gap-1">
                      <Truck size={14} />
                      <span>{trip.name}</span>
                      {myCount > 0 && (
                        <span className="text-xs px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-800 font-bold">
                          {myCount}
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
              <button
                onClick={() => setSelectedTrip(null)}
                className={`px-4 py-2 font-medium whitespace-nowrap text-xs ${
                  selectedTrip === null
                    ? "text-blue-600 border-b-2 border-blue-600 bg-blue-50"
                    : "text-gray-600"
                }`}
              >
                Unassigned ({unassignedOrders.length})
              </button>
            </div>
          </div>

          {currentTrip ? (
            <div className="space-y-3">
              {/* Trip Header - Compact */}
              <div className="bg-white p-3 rounded-lg shadow">
                <div className="space-y-2">
                  {/* Top row: Date, Orders, Gallons Delivered */}
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
                    <div>
                      <span className="text-gray-600">Date:</span>
                      <span className="ml-1 font-medium">{currentTrip.trip_date}</span>
                    </div>
                    <div>
                      <span className="text-gray-600">Orders:</span>
                      <span className="ml-1 font-bold text-blue-600">{getMyOrdersCount(currentTrip)}</span>
                    </div>
                    <div>
                      <span className="text-gray-600">Gallons:</span>
                      <span className="ml-1 font-bold text-purple-600">{getTripGallons(currentTrip).toLocaleString()}</span>
                    </div>
                  </div>
                  
                  <div className="flex justify-between items-center">
                    <h3 className="font-bold text-base">{currentTrip.name}</h3>
                    <div className="flex gap-2">
                      {/* ADDED: Product totals button */}
                      {getMyOrdersCount(currentTrip) > 0 && (
                        <button
                          onClick={() => setShowProductTotals(true)}
                          className="bg-purple-600 text-white px-2 py-1.5 rounded-lg hover:bg-purple-700 flex items-center gap-1 text-xs"
                          title="View product totals"
                        >
                          <Package size={14} />
                        </button>
                      )}
                      {getMyOrdersCount(currentTrip) === 0 && currentTrip.order_ids?.length === 0 && (
                        <button
                          onClick={() => handleDeleteTrip(currentTrip.id)}
                          className="bg-red-600 text-white px-3 py-1.5 rounded-lg text-xs"
                        >
                          Delete
                        </button>
                      )}
                    </div>
                  </div>
                  
                  <div>
                    <label className="text-xs text-gray-600">Driver:</label>
                    <input
                      type="text"
                      value={currentTrip.driver || ""}
                      onChange={(e) => handleUpdateDriver(currentTrip.id, e.target.value)}
                      placeholder="Enter driver name"
                      className="w-full px-2 py-1.5 border rounded text-sm mt-1"
                    />
                  </div>
                </div>
              </div>

              {/* Trip Orders - Mobile Optimized */}
              {getTripOrders(currentTrip).length > 0 ? (
                <div className="space-y-2">
                  {getTripOrders(currentTrip).map((order, index) => (
                    <div key={order.id} className="bg-white p-3 rounded-lg shadow border-l-4 border-blue-500">
                      <div className="flex items-start gap-2">
                        <div className="bg-blue-600 text-white rounded-full w-7 h-7 flex items-center justify-center font-bold text-xs flex-shrink-0">
                          {index + 1}
                        </div>
                        <div className="flex-1 min-w-0">
                          <h4 className="font-bold text-sm">{order.customer_name}</h4>
                          <p className="text-xs text-gray-600 flex items-start gap-1 mt-1">
                            <MapPin size={10} className="mt-0.5 flex-shrink-0" />
                            <span className="line-clamp-2">{order.customer_address}</span>
                          </p>
                          <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1 text-xs">
                            <div>
                              <span className="text-gray-600">Amount:</span>
                              <span className="ml-1 font-medium text-green-600">
                                Rp {order.total_amount?.toLocaleString() || 0}
                              </span>
                            </div>
                            <div>
                              <span className="text-gray-600">Gallons Delivered:</span>
                              <span className="ml-1 font-medium text-purple-600">
                                {getOrderGallons(order.id).toLocaleString()}
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>
                      
                      {/* Action Buttons - Stacked on Mobile */}
                      <div className="flex gap-2 mt-2">
                        {order.customer_whatsapp && (
                          <a
                            href={`https://wa.me/${order.customer_whatsapp}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex-1 bg-green-600 text-white px-3 py-2 rounded-lg hover:bg-green-700 flex items-center justify-center gap-1 text-xs"
                          >
                            <MessageCircle size={14} />
                            WA
                          </a>
                        )}
                        <button
                          onClick={() => {
                            setReceiptOrder(order);
                            setShowReceipt(true);
                          }}
                          className="flex-1 px-3 py-2 rounded-lg flex items-center justify-center gap-1 text-xs font-bold"
                          style={{ backgroundColor: '#f97316', color: 'white' }}
                        >
                          <FileText size={14} />
                          Receipt
                        </button>
                        <button
                          onClick={() => handleOpenConfirmModal(order)}
                          className="flex-1 bg-blue-600 text-white px-3 py-2 rounded-lg hover:bg-blue-700 flex items-center justify-center gap-1 font-medium text-xs"
                        >
                          <Camera size={14} />
                          Confirm
                        </button>
                        <button
                          onClick={() => handleRemoveOrderFromTrip(order.id, currentTrip.id)}
                          className="bg-red-100 text-red-700 px-3 py-2 rounded-lg hover:bg-red-200 font-medium text-xs"
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 bg-white rounded-lg shadow">
                  <Truck size={40} className="mx-auto mb-2 text-gray-400" />
                  <p className="font-medium text-gray-600 text-sm">No orders assigned</p>
                  <p className="text-xs text-gray-500 mt-1">Go to "Unassigned" tab</p>
                </div>
              )}
            </div>
          ) : (
            // Unassigned Orders
            <div className="space-y-3 mt-4">
              <div className="bg-blue-50 p-3 rounded-lg border border-blue-200">
                <h3 className="font-bold text-blue-900 text-sm">Unassigned Orders</h3>
                <p className="text-xs text-blue-700 mt-0.5">{currentUser.branch} Branch</p>
              </div>

              {unassignedOrders.length > 0 ? (
                <div className="space-y-2">
                  {unassignedOrders.map((order) => (
                    <div key={order.id} className="bg-white p-3 rounded-lg shadow border">
                      <div className="space-y-2">
                        <div>
                          <h4 className="font-bold text-sm">{order.customer_name}</h4>
                          <p className="text-xs text-gray-600 flex items-start gap-1 mt-1">
                            <MapPin size={10} className="mt-0.5 flex-shrink-0" />
                            <span className="line-clamp-2">{order.customer_address}</span>
                          </p>
                          <div className="flex gap-2 mt-1 text-xs">
                            <span className="text-gray-600">📅 {order.delivery_date}</span>
                            <span className="font-medium text-green-600">
                              Rp {order.total_amount?.toLocaleString() || 0}
                            </span>
                          </div>
                        </div>
                        <select
                          onChange={(e) => {
                            if (e.target.value) {
                              handleAddOrderToTrip(order.id, e.target.value);
                              e.target.value = "";
                            }
                          }}
                          className="w-full px-3 py-2 border-2 border-blue-600 rounded-lg bg-white text-blue-600 font-medium text-xs"
                          defaultValue=""
                        >
                          <option value="" disabled>Assign to Trip →</option>
                          {trips.map((trip) => (
                            <option key={trip.id} value={trip.id}>{trip.name}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 bg-white rounded-lg shadow">
                  <CheckCircle size={40} className="mx-auto mb-2 text-green-400" />
                  <p className="font-bold text-gray-600 text-sm">All orders assigned!</p>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* ADDED: Product Totals Modal */}
      {showProductTotals && currentTrip && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg max-w-md w-full p-6">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-bold flex items-center gap-2">
                <Package className="text-purple-600" />
                Product Totals - {currentTrip.name}
              </h3>
              <button
                onClick={() => setShowProductTotals(false)}
                className="text-gray-400 hover:text-gray-600 text-2xl"
              >
                ×
              </button>
            </div>
            
            {(() => {
              const productTotals = getTripProductTotals(currentTrip);
              const hasProducts = Object.keys(productTotals).length > 0;
              
              return hasProducts ? (
                <div className="space-y-3">
                  {Object.entries(productTotals).map(([product, quantity]) => (
                    <div key={product} className="flex justify-between items-center p-3 bg-gray-50 rounded">
                      <span className="font-medium text-gray-800">{product}</span>
                      <span className="text-xl font-bold text-purple-600">× {quantity}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-gray-500 text-center py-4">No products in this trip</p>
              );
            })()}

            <button
              onClick={() => setShowProductTotals(false)}
              className="w-full mt-6 bg-purple-600 text-white py-2 rounded-lg hover:bg-purple-700"
            >
              Close
            </button>
          </div>
        </div>
      )}

      {/* Delivery Confirmation Modal */}
      {showConfirmModal && confirmingOrder && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-3">
          <div className="bg-white rounded-lg max-w-md w-full max-h-[95vh] overflow-y-auto">
            <div className="sticky top-0 bg-white p-3 border-b flex justify-between items-center">
              <h3 className="text-base font-bold">Confirm Delivery</h3>
              <button
                onClick={() => {
                  setShowConfirmModal(false);
                  setConfirmingOrder(null);
                  setDeliveryPhoto(null);
                  setDeliveryPhotoPreview(null);
                  setEmptyGallonsReturned(0);
                  setActualDelivered(0);
                  setDeliveryNotes("");
                }}
                className="text-gray-400 hover:text-gray-600"
              >
                <X size={20} />
              </button>
            </div>

            <div className="p-3 space-y-3">
              {/* Order Info - Compact */}
              <div className="p-2 bg-gray-50 rounded-lg text-xs">
                <p className="font-bold">{confirmingOrder.customer_name}</p>
                <p className="text-gray-600 text-xs">{confirmingOrder.customer_address}</p>
                
                {/* Order Items - Compact */}
                {(() => {
                  const items = orderItems[confirmingOrder.id] || [];
                  const refillItems = items.filter(item => 
                    item.product && 
                    item.product.toLowerCase().includes('gallon') && 
                    item.is_refill === true
                  );
                  
                  return refillItems.length > 0 && (
                    <div className="mt-1 pt-1 border-t">
                      <p className="text-xs font-semibold text-blue-700">Refill:</p>
                      {refillItems.map((item, idx) => (
                        <p key={idx} className="text-xs text-gray-600">
                          • {item.product} × {item.quantity}
                        </p>
                      ))}
                    </div>
                  );
                })()}
                
                {/* Original Bill - Compact */}
                <div className="flex justify-between mt-1 pt-1 border-t text-xs">
                  <span className="text-gray-600">Bill:</span>
                  <span className="font-bold">Rp {confirmingOrder.total_amount?.toLocaleString() || 0}</span>
                </div>
              </div>

              {/* Delivery Adjustments - Compact */}
              <div className="p-2 bg-blue-50 rounded-lg border border-blue-200">
                <p className="text-xs font-bold text-blue-900 mb-2">Adjustments (Refill only)</p>
                
                {/* Three boxes in one row - Smaller */}
                <div className="grid grid-cols-3 gap-1 mb-2">
                  <div>
                    <label className="block text-xs font-bold mb-1">Delivered</label>
                    <input
                      type="number"
                      value={actualDelivered}
                      onChange={(e) => setActualDelivered(parseInt(e.target.value) || 0)}
                      className="w-full px-1 py-1.5 border-2 border-green-300 rounded text-sm font-bold text-center"
                      min="0"
                    />
                  </div>
                  
                  <div>
                    <label className="block text-xs font-bold mb-1">Empty</label>
                    <input
                      type="number"
                      value={emptyGallonsReturned}
                      onChange={(e) => setEmptyGallonsReturned(parseInt(e.target.value) || 0)}
                      className="w-full px-1 py-1.5 border-2 border-blue-300 rounded text-sm font-bold text-center"
                      min="0"
                    />
                  </div>
                  
                  <div>
                    <label className="block text-xs font-bold mb-1">Borrowed</label>
                    <div className={`w-full px-1 py-1.5 border-2 rounded text-sm font-bold text-center ${
                      (actualDelivered - emptyGallonsReturned) > 0 ? 'border-orange-300 bg-orange-50 text-orange-600' : 
                      (actualDelivered - emptyGallonsReturned) < 0 ? 'border-blue-300 bg-blue-50 text-blue-600' : 
                      'border-green-300 bg-green-50 text-green-600'
                    }`}>
                      {actualDelivered - emptyGallonsReturned > 0 && '+'}
                      {actualDelivered - emptyGallonsReturned}
                    </div>
                  </div>
                </div>

                {/* Updated Bill - Compact */}
                {(() => {
                  const items = orderItems[confirmingOrder.id] || [];
                  let newTotal = 0;
                  
                  items.forEach(item => {
                    if (item.product && item.product.toLowerCase().includes('gallon') && item.is_refill === true) {
                      const finalPrice = item.unit_price - (item.discount || 0);
                      newTotal += finalPrice * actualDelivered;
                    } else {
                      const finalPrice = item.unit_price - (item.discount || 0);
                      newTotal += finalPrice * item.quantity;
                    }
                  });
                  
                  const originalTotal = confirmingOrder.total_amount || 0;
                  const difference = newTotal - originalTotal;
                  
                  return (
                    <div className="p-2 bg-yellow-50 rounded border border-yellow-300">
                      <div className="flex justify-between items-center text-xs">
                        <span className="font-bold">New Bill:</span>
                        <span className="text-base font-bold text-green-600">
                          Rp {newTotal.toLocaleString()}
                        </span>
                      </div>
                      {difference !== 0 && (
                        <p className={`text-xs ${difference > 0 ? 'text-red-600' : 'text-green-600'}`}>
                          {difference > 0 ? '▲' : '▼'} {difference > 0 ? '+' : ''}Rp {difference.toLocaleString()}
                        </p>
                      )}
                    </div>
                  );
                })()}

                {/* Notes - Compact */}
                <div className="mt-2">
                  <label className="block text-xs font-bold mb-1">Notes</label>
                  <textarea
                    value={deliveryNotes}
                    onChange={(e) => setDeliveryNotes(e.target.value)}
                    placeholder="Any remarks..."
                    className="w-full px-2 py-1 border rounded text-xs"
                    rows={2}
                  />
                </div>
              </div>

              {/* Photo Upload - Compact */}
              <div>
                <label className="block text-xs font-bold mb-1">Delivery Photo *</label>
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={handlePhotoUpload}
                  className="w-full px-2 py-1 border rounded text-xs"
                />
              </div>

              {deliveryPhotoPreview && (
                <div>
                  <p className="text-xs font-medium mb-1">Preview:</p>
                  <img
                    src={deliveryPhotoPreview}
                    alt="Delivery preview"
                    className="w-full h-32 object-cover border rounded"
                  />
                </div>
              )}

              {/* Action Buttons - Compact */}
              <div className="flex gap-2">
                <button
                  onClick={handleConfirmDelivery}
                  disabled={!deliveryPhoto || uploadingPhoto}
                  className="flex-1 bg-green-600 text-white py-2.5 rounded-lg hover:bg-green-700 disabled:bg-gray-400 flex items-center justify-center gap-2 text-sm font-bold"
                >
                  {uploadingPhoto ? (
                    <>
                      <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent"></div>
                      Uploading...
                    </>
                  ) : (
                    <>
                      <CheckCircle size={16} />
                      Confirm
                    </>
                  )}
                </button>
                <button
                  onClick={() => {
                    setShowConfirmModal(false);
                    setConfirmingOrder(null);
                    setDeliveryPhoto(null);
                    setDeliveryPhotoPreview(null);
                    setEmptyGallonsReturned(0);
                    setActualDelivered(0);
                    setDeliveryNotes("");
                  }}
                  className="px-4 bg-gray-300 text-gray-700 py-2.5 rounded-lg hover:bg-gray-400 text-sm font-bold"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ADDED: Receipt Modal */}
      {showReceipt && receiptOrder && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg max-w-md w-full p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-lg font-bold">Draft Receipt</h3>
              <button
                onClick={() => {
                  setShowReceipt(false);
                  setReceiptOrder(null);
                }}
                className="text-gray-400 hover:text-gray-600"
              >
                <X size={24} />
              </button>
            </div>

            {/* Receipt Content */}
            <div className="border-2 border-gray-300 p-4 rounded-lg">
              {/* Header */}
              <div className="text-center border-b-2 border-gray-300 pb-3 mb-3">
                <h2 className="text-xl font-bold">VIVIDAQUA</h2>
                <p className="text-sm text-gray-600">{receiptOrder.branch}</p>
                <p className="text-xs text-gray-500 mt-1">
                   {formatDateLocalizedJakarta(new Date())}
                </p>
              </div>

              {/* Customer Info */}
              <div className="mb-4 text-sm">
                <p className="font-bold">{receiptOrder.customer_name}</p>
                <p className="text-gray-600 text-xs">{receiptOrder.customer_address}</p>
              </div>

              {/* Items */}
              <div className="border-t border-b border-gray-300 py-3 mb-3">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200">
                      <th className="text-left py-1">Item</th>
                      <th className="text-center py-1">Qty</th>
                      <th className="text-right py-1">Price</th>
                      <th className="text-right py-1">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(() => {
                      const items = orderItems[receiptOrder.id] || [];
                      return items.length > 0 ? (
                        items.map((item, idx) => (
                          <tr key={idx} className="border-b border-gray-100">
                            <td className="py-2 text-xs">{item.product}</td>
                            <td className="text-center py-2">{item.quantity}</td>
                            <td className="text-right py-2 text-xs">
                              {((item.unit_price - item.discount) || 0).toLocaleString()}
                            </td>
                            <td className="text-right py-2 font-medium">
                              {(((item.unit_price - item.discount) * item.quantity) || 0).toLocaleString()}
                            </td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan="4" className="text-center py-2 text-gray-500 text-xs">
                            No items
                          </td>
                        </tr>
                      );
                    })()}
                  </tbody>
                </table>
              </div>

              {/* Total */}
              <div className="flex justify-between items-center font-bold text-lg mb-4">
                <span>TOTAL:</span>
                <span>Rp {receiptOrder.total_amount?.toLocaleString() || 0}</span>
              </div>

              {/* Footer */}
              <div className="text-center text-xs text-gray-600 border-t border-gray-300 pt-3">
                <p>Terima kasih atas kepercayaan Anda!</p>
                <p className="mt-1">~ Draft Receipt ~</p>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="mt-6 space-y-2">
              <button
                onClick={() => window.print()}
                className="w-full bg-blue-600 text-white py-2 rounded-lg hover:bg-blue-700 flex items-center justify-center gap-2"
              >
                <FileText size={18} />
                Print Receipt
              </button>
              <button
                onClick={() => {
                  setShowReceipt(false);
                  setReceiptOrder(null);
                }}
                className="w-full bg-gray-300 text-gray-700 py-2 rounded-lg hover:bg-gray-400"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
