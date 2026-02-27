// src/Types/index.ts
// 统一类型定义文件

export interface Customer {
  id: string;
  phone_number: string;
  name?: string;
  address?: string;
  balance: number;
  created_at: string;
}

export interface Product {
  id: string;
  name: string;
  price: number;
  unit: string;
  is_refill: boolean;
  status: 'active' | 'inactive';
  created_at: string;
  updated_at: string;
}

export interface OrderItem {
  id: string;
  order_id: string;
  product: string;
  is_refill: boolean;
  quantity: number;
  unit_price: number;
  discount: number;
  created_at: string;
}

export interface Order {
  id: string;
  customer_id: string;
  customer_name: string;
  customer_address: string;
  customer_whatsapp: string;
  customer_discount: number;
  branch: string;
  total_amount: number;
  status: 'pending' | 'scheduled' | 'delivered';
  payment_status: 'unpaid' | 'paid';
  payment_evidence?: string;
  paid_date?: string;
  delivery_date: string;
  delivery_evidence?: string;
  delivered_date?: string;
  created_by?: string;
  created_at: string;
  updated_at: string;
  empty_gallons_returned: number;
  borrowed_gallons: number;
  delivery_notes?: string;
  // 关联数据
  order_items?: OrderItem[];
}

export interface DeliveryTimeSlot {
  id: string;
  time_range: string;
  is_available: boolean;
}

export interface VoucherPackage {
  id: string;
  name: string;
  quantity: number;
  price: number;
  bonus_quantity?: number;
  description?: string;
}
