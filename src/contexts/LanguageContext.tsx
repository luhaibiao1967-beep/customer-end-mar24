// src/contexts/LanguageContext.tsx
import React, { createContext, useContext, useState, useEffect } from 'react';

export type Language = 'en' | 'id';

interface LanguageContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: (key: string) => string;
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

const translations: Record<Language, Record<string, string>> = {
  en: {
    // Navigation
    'nav.home': 'Home',
    'nav.myOrders': 'My Orders',
    'nav.newOrder': 'New Order',
    'nav.myAccount': 'My Account',
    
    // Common
    'common.back': 'Back',
    'common.loading': 'Loading...',
    'common.error': 'Error',
    'common.success': 'Success',
    'common.confirm': 'Confirm',
    'common.cancel': 'Cancel',
    'common.save': 'Save',
    'common.close': 'Close',
    'common.total': 'Total',
    
    // Order Delivery
    'delivery.title': 'Delivery Details',
    'delivery.orderStatus': 'Order Status',
    'delivery.deliveryInfo': 'Delivery Information',
    'delivery.orderDetails': 'Order Details',
    'delivery.customerName': 'Customer Name',
    'delivery.deliveryAddress': 'Delivery Address',
    'delivery.contactPhone': 'Contact Phone',
    'delivery.deliveryDate': 'Delivery Date',
    'delivery.actualDelivery': 'Actual Delivery',
    'delivery.deliveryNotes': 'Delivery Notes',
    'delivery.confirmReceipt': 'Confirm Receipt',
    'delivery.pleaseConfirm': 'Please confirm that you have received the delivery',
    'delivery.confirmButton': 'Confirm Receipt',
    'delivery.confirming': 'Confirming...',
    'delivery.deliveryComplete': 'Delivery Complete',
    'delivery.thankYou': 'Thank you for your order!',
    'delivery.viewMore': 'View More Orders',
    'delivery.deliveryEvidence': 'Delivery Evidence',
    'delivery.emptyGallons': 'Empty Gallons Returned',
    'delivery.borrowedGallons': 'Borrowed Gallons',
    'delivery.customerDiscount': 'Customer Discount',
    'delivery.orderTotal': 'Order Total',
    'delivery.refill': 'Refill',
    'delivery.tips': 'Please check the goods before confirming',
    'delivery.contact': 'If you have any questions, please contact customer service',
    'delivery.confirmMessage': 'Confirm receipt? This action cannot be undone.',
    'delivery.confirmSuccess': 'Receipt confirmed successfully!',
    'delivery.confirmFailed': 'Confirmation failed',
    'delivery.loadFailed': 'Loading Failed',
    'delivery.orderNotFound': 'Order not found',
    'delivery.returnToList': 'Return to Order List',
    'delivery.loadingOrder': 'Loading order information...',
    
    // Order Status
    'status.pending': 'Pending',
    'status.scheduled': 'Scheduled',
    'status.delivered': 'Delivered',
    'status.cancelled': 'Cancelled',
    'status.paid': 'Paid',
    'status.unpaid': 'Unpaid',
    'status.confirmed': 'Confirmed',
    'status.outForDelivery': 'Out for Delivery',
    
    // Progress Steps
    'progress.confirmed': 'Confirmed',
    'progress.delivering': 'Delivering',
    'progress.delivered': 'Delivered',
    
    // Order History
    'orders.title': 'Order History',
    'orders.empty': 'No Orders Yet',
    'orders.emptyDesc': 'You haven\'t placed any orders yet.\nStart ordering to see your history here!',
    'orders.startOrdering': 'Start Ordering',
    'orders.errorLoading': 'Error Loading Orders',
    'orders.tryAgain': 'Try Again',
    'orders.orderId': 'Order',
    'orders.deliveryDate': 'Delivery Date',
    'orders.totalAmount': 'Total Amount',
    'orders.paymentStatus': 'Payment Status',
    'orders.orderedOn': 'Ordered on',
    'orders.viewDetails': 'View Delivery Details',
    
    // Place Order
    'placeOrder.title': 'Place New Order',
    'placeOrder.selectProducts': 'Select Products',
    'placeOrder.deliveryInfo': 'Delivery Information',
    'placeOrder.orderSummary': 'Order Summary',
    'placeOrder.submit': 'Place Order',
    
    // Account
    'account.title': 'My Account',
    'account.profile': 'Profile',
    'account.settings': 'Settings',
    'account.logout': 'Logout',
    
    // Language
    'lang.switch': 'Language',
    'lang.english': 'English',
    'lang.indonesian': 'Bahasa Indonesia',
    
    // Login
    'login.title': 'Order Water',
    'login.subtitle': 'Enter your WhatsApp number',
    'login.whatsappLabel': 'WhatsApp Number',
    'login.whatsappPlaceholder': '812-3456-7890',
    'login.continue': 'Continue',
    'login.checking': 'Checking...',
    'login.notRegistered': 'Number not registered. Please register.',
    'login.register': 'Register Now',
    'login.noAccount': "Don't have an account?",
    'login.registerHere': 'Register here',
    'login.tryOtherNumber': 'Try another number',
  },
  id: {
    // Navigation
    'nav.home': 'Beranda',
    'nav.myOrders': 'Pesanan Saya',
    'nav.newOrder': 'Pesan Baru',
    'nav.myAccount': 'Akun Saya',
    
    // Common
    'common.back': 'Kembali',
    'common.loading': 'Memuat...',
    'common.error': 'Kesalahan',
    'common.success': 'Berhasil',
    'common.confirm': 'Konfirmasi',
    'common.cancel': 'Batal',
    'common.save': 'Simpan',
    'common.close': 'Tutup',
    'common.total': 'Total',
    
    // Order Delivery
    'delivery.title': 'Detail Pengiriman',
    'delivery.orderStatus': 'Status Pesanan',
    'delivery.deliveryInfo': 'Informasi Pengiriman',
    'delivery.orderDetails': 'Detail Pesanan',
    'delivery.customerName': 'Nama Pelanggan',
    'delivery.deliveryAddress': 'Alamat Pengiriman',
    'delivery.contactPhone': 'Nomor Telepon',
    'delivery.deliveryDate': 'Tanggal Pengiriman',
    'delivery.actualDelivery': 'Pengiriman Aktual',
    'delivery.deliveryNotes': 'Catatan Pengiriman',
    'delivery.confirmReceipt': 'Konfirmasi Penerimaan',
    'delivery.pleaseConfirm': 'Mohon konfirmasi bahwa Anda telah menerima pengiriman',
    'delivery.confirmButton': 'Konfirmasi Penerimaan',
    'delivery.confirming': 'Mengonfirmasi...',
    'delivery.deliveryComplete': 'Pengiriman Selesai',
    'delivery.thankYou': 'Terima kasih atas pesanan Anda!',
    'delivery.viewMore': 'Lihat Pesanan Lainnya',
    'delivery.deliveryEvidence': 'Bukti Pengiriman',
    'delivery.emptyGallons': 'Galon Kosong Dikembalikan',
    'delivery.borrowedGallons': 'Galon Dipinjam',
    'delivery.customerDiscount': 'Diskon Pelanggan',
    'delivery.orderTotal': 'Total Pesanan',
    'delivery.refill': 'Isi Ulang',
    'delivery.tips': 'Silakan periksa barang sebelum mengonfirmasi',
    'delivery.contact': 'Jika ada pertanyaan, hubungi layanan pelanggan',
    'delivery.confirmMessage': 'Konfirmasi penerimaan? Tindakan ini tidak dapat dibatalkan.',
    'delivery.confirmSuccess': 'Penerimaan berhasil dikonfirmasi!',
    'delivery.confirmFailed': 'Konfirmasi gagal',
    'delivery.loadFailed': 'Gagal Memuat',
    'delivery.orderNotFound': 'Pesanan tidak ditemukan',
    'delivery.returnToList': 'Kembali ke Daftar Pesanan',
    'delivery.loadingOrder': 'Memuat informasi pesanan...',
    
    // Order Status
    'status.pending': 'Menunggu',
    'status.scheduled': 'Dijadwalkan',
    'status.delivered': 'Terkirim',
    'status.cancelled': 'Dibatalkan',
    'status.paid': 'Dibayar',
    'status.unpaid': 'Belum Dibayar',
    'status.confirmed': 'Dikonfirmasi',
    'status.outForDelivery': 'Dalam Pengiriman',
    
    // Progress Steps
    'progress.confirmed': 'Dikonfirmasi',
    'progress.delivering': 'Dalam Pengiriman',
    'progress.delivered': 'Terkirim',
    
    // Order History
    'orders.title': 'Riwayat Pesanan',
    'orders.empty': 'Belum Ada Pesanan',
    'orders.emptyDesc': 'Anda belum melakukan pesanan.\nMulai pesan untuk melihat riwayat di sini!',
    'orders.startOrdering': 'Mulai Pesan',
    'orders.errorLoading': 'Gagal Memuat Pesanan',
    'orders.tryAgain': 'Coba Lagi',
    'orders.orderId': 'Pesanan',
    'orders.deliveryDate': 'Tanggal Pengiriman',
    'orders.totalAmount': 'Total Pembayaran',
    'orders.paymentStatus': 'Status Pembayaran',
    'orders.orderedOn': 'Dipesan pada',
    'orders.viewDetails': 'Lihat Detail Pengiriman',
    
    // Place Order
    'placeOrder.title': 'Buat Pesanan Baru',
    'placeOrder.selectProducts': 'Pilih Produk',
    'placeOrder.deliveryInfo': 'Informasi Pengiriman',
    'placeOrder.orderSummary': 'Ringkasan Pesanan',
    'placeOrder.submit': 'Buat Pesanan',
    
    // Account
    'account.title': 'Akun Saya',
    'account.profile': 'Profil',
    'account.settings': 'Pengaturan',
    'account.logout': 'Keluar',
    
    // Language
    'lang.switch': 'Bahasa',
    'lang.english': 'English',
    'lang.indonesian': 'Bahasa Indonesia',
    
    // Login
    'login.title': 'Pesan Air',
    'login.subtitle': 'Masukkan nomor WhatsApp Anda',
    'login.whatsappLabel': 'Nomor WhatsApp',
    'login.whatsappPlaceholder': '812-3456-7890',
    'login.continue': 'Lanjut',
    'login.checking': 'Memeriksa...',
    'login.notRegistered': 'Nomor belum terdaftar. Silakan daftar.',
    'login.register': 'Daftar Sekarang',
    'login.noAccount': 'Belum punya akun?',
    'login.registerHere': 'Daftar di sini',
    'login.tryOtherNumber': 'Coba nomor lain',
  },
};

export const LanguageProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [language, setLanguageState] = useState<Language>(() => {
    const saved = localStorage.getItem('app_language');
    return (saved === 'en' || saved === 'id') ? saved : 'id';
  });

  useEffect(() => {
    localStorage.setItem('app_language', language);
  }, [language]);

  const setLanguage = (lang: Language) => {
    setLanguageState(lang);
  };

  const t = (key: string): string => {
    return translations[language][key] || key;
  };

  return (
    <LanguageContext.Provider value={{ language, setLanguage, t }}>
      {children}
    </LanguageContext.Provider>
  );
};

export const useLanguage = () => {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error('useLanguage must be used within a LanguageProvider');
  }
  return context;
};
