// src/Pages/PlaceOrder.tsx - Add New Delivery Order
import { useState, useEffect, Fragment, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import BottomNavV0 from '../Components/BottomNavV0';
import { theme } from '../theme';
import { formatCurrency } from '../utils/format';
import { getPaymentTermTranslationKey } from '../utils/paymentTerm';
import toast from 'react-hot-toast';
import { useLanguage } from '../contexts/LanguageContext';
import { useColorTokens } from '../contexts/ColorTokensContext';
import { Package2 } from 'lucide-react';
import LanguageSwitcher from '../Components/LanguageSwitcher';
import {
  getMinimumDeliveryDate,
  isWeekdayClosed,
  snapToNextOpenDay,
} from '../utils/deliverySchedule';
import { fetchCustomerVouchers as loadCustomerVouchers } from '../lib/customerVouchers';

interface Customer {
  id: string;
  name: string;
  address: string;
  whatsapp: string;
  customer_type: string;
  payment_term?: string;
  credit_limit?: number | null;
  voucher_balance: number;
  branch: string;
  discount: number;
}

interface Product {
  id: string;
  name: string;
  price: number;
  unit: string;
  is_refill: boolean;
  status: string;
}

interface CartItem {
  product: Product;
  quantity: number;
}

interface PlaceOrderProps {
  customer: Customer;
}

// Base price for refill gallon — update here if price changes
const REFILL_BASE_PRICE = 15000;

/** DB: featured first = `Gallon Refill 19 liter`; Accessories include `Electric Pump` (name contains `pump` or `rack`). */
const CANONICAL_GALLON_REFILL_19_LITER = 'gallon refill 19 liter';

function normalizeProductName(name: string): string {
  return name.toLowerCase().replace(/\s+/g, ' ').trim();
}

const isAccessory = (p: Product) => {
  const n = normalizeProductName(p.name);
  return n.includes('pump') || n.includes('rack');
};

/** Main list: pin "Gallon Refill 19 liter" first (exact name from products table). */
const isFeaturedRefill19Liter = (p: Product): boolean =>
  normalizeProductName(p.name) === CANONICAL_GALLON_REFILL_19_LITER;

/** Customer can order empty gallon products; hide collection/recovery SKUs (operator enters those). */
const isCustomerHiddenProduct = (nameLower: string): boolean => {
  if (nameLower.includes('sample')) return true;
  if (nameLower.includes('empty gallon collection')) return true;
  if (nameLower.includes('empty') && nameLower.includes('collection')) return true;
  return false;
};

function weekdayFromYmd(ymd: string): number {
  return new Date(`${ymd}T12:00:00+07:00`).getUTCDay();
}

function addDaysYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days, 12, 0, 0));
  return dt.toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
}

function jakartaTodayYmd(now = new Date()): string {
  return now.toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
}

function monthlyCutoffYmd(ymd: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return ymd;
  const [y, m] = ymd.split('-');
  return `${y}-${m}-20`;
}

function weeklyCutoffYmd(ymd: string): string {
  const day = weekdayFromYmd(ymd); // 0=Sun..6=Sat
  const iso = day === 0 ? 7 : day; // 1=Mon..7=Sun
  return addDaysYmd(ymd, 7 - iso);
}

function quarterlyCutoffYmd(ymd: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return ymd;
  const [ys, ms] = ymd.split('-');
  let y = Number(ys);
  let m = Number(ms) + 1;
  if (m > 12) {
    m = 1;
    y += 1;
  }
  return `${y}-${String(m).padStart(2, '0')}-20`;
}

function graceUntilByTerm(termRaw: unknown, orderYmd: string): string {
  const term = typeof termRaw === 'string' ? termRaw.toLowerCase() : '';
  if (term === 'daily') return orderYmd;
  if (term === 'weekly') return weeklyCutoffYmd(orderYmd);
  if (term === 'monthly') return monthlyCutoffYmd(orderYmd);
  if (term === 'quarterly') return quarterlyCutoffYmd(orderYmd);
  return orderYmd;
}

function shouldBlockOutstanding(
  termRaw: unknown,
  orders: { payment_status?: string; status?: string; delivery_date?: string }[],
): boolean {
  const todayYmd = jakartaTodayYmd();
  return orders.some((o) => {
    if (o.payment_status !== 'unpaid') return false;
    if (o.status !== 'delivered') return false;
    if (!o.delivery_date) return false;
    const grace = graceUntilByTerm(termRaw, o.delivery_date);
    return todayYmd > grace;
  });
}

interface StoredPrepayCheckout {
  checkoutKey: string;
  fingerprint: string;
  productDeductions: { product_id: string; quantity: number }[];
}

interface StoredVoucherOnlyOrder {
  orderKey: string;
  fingerprint: string;
  productDeductions: { product_id: string; quantity: number }[];
}

interface StoredLaterPayOrder {
  orderKey: string;
  fingerprint: string;
  items: {
    product_id: string;
    product: string;
    is_refill: boolean;
    quantity: number;
    unit_price: number;
    discount: number;
  }[];
  productDeductions: { product_id: string; quantity: number }[];
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PREPAY_CHECKOUT_IN_USE_MESSAGE =
  'Another payment checkout is still unresolved. Finish or retry that same checkout before starting a different order. This order was not submitted.';
const PREPAY_CHECKOUT_STORAGE_MESSAGE =
  'Secure payment retry storage is unavailable. Enable browser storage and close other checkout tabs before trying again.';
const LATER_PAY_ORDER_IN_USE_MESSAGE =
  'Another order submission is still unresolved. Retry that same order before starting a different one.';
const LATER_PAY_ORDER_STORAGE_MESSAGE =
  'Secure order retry storage is unavailable. Enable browser storage and close other order tabs before trying again.';

async function sha256Hex(value: string): Promise<string> {
  const input = new TextEncoder().encode(value);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', input);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function createCheckoutKey(): string {
  if (typeof globalThis.crypto.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export default function PlaceOrder({ customer }: PlaceOrderProps) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { t, language } = useLanguage();
  const { tokens, isDark } = useColorTokens();
  const editOrderId = searchParams.get('edit');

  const [products, setProducts] = useState<Product[]>([]);
  const [cart, setCart] = useState<Map<string, number>>(new Map());
  const [deliveryDate, setDeliveryDate] = useState(() =>
    getMinimumDeliveryDate(new Date(), 16, []),
  );
  const [branchSchedule, setBranchSchedule] = useState<{
    order_cutoff_hour: number;
    closed_weekdays: number[];
  } | null>(null);
  const [editOrderBranch, setEditOrderBranch] = useState<{
    orderId: string;
    branch: string;
  } | null>(null);
  const [showScheduleNotice, setShowScheduleNotice] = useState(true);
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [showSuccess, setShowSuccess] = useState(false);
  const inMemoryPrepayCheckout = useRef<StoredPrepayCheckout | null>(null);
  const inMemoryVoucherOnlyOrder = useRef<StoredVoucherOnlyOrder | null>(null);
  const inMemoryLaterPayOrder = useRef<StoredLaterPayOrder | null>(null);

  // Fresh customer data
  const [freshDiscount, setFreshDiscount] = useState<number>(customer.discount || 0);
  const [paymentTerm, setPaymentTerm] = useState(customer.payment_term || '');

  // Unpaid orders block (later_pay by payment_term rules)
  const [blockedByUnpaid, setBlockedByUnpaid] = useState(false);
  const [showUnpaidModal, setShowUnpaidModal] = useState(false);

  // Credit limit (later_pay)
  const [creditLimit, setCreditLimit] = useState<number | null>(null);
  const [unpaidCredit, setUnpaidCredit] = useState<number>(0);

  // Per-product voucher balances: productId → balance (gift_balance is free welcome tickets, consumed first)
  const [productVouchers, setProductVouchers] = useState<Map<string, number>>(new Map());
  const [productVouchersGift, setProductVouchersGift] = useState<Map<string, number>>(new Map());

  // Accessories section collapsed by default
  const [showAccessories, setShowAccessories] = useState(false);

  const isPrePay = customer.customer_type === 'pre_pay';
  const paymentTermLabel = t(getPaymentTermTranslationKey(paymentTerm));
  const serviceBranch = editOrderId && editOrderBranch?.orderId === editOrderId
    ? editOrderBranch.branch
    : customer.branch;

  const getUnitPrice = (product: Product): number => {
    if (isPrePay) return product.price;
    if (product.is_refill) return Math.max(0, REFILL_BASE_PRICE - freshDiscount);
    return product.price;
  };

  const loadSnapScript = (clientKey: string, snapJsUrl: string): Promise<void> =>
    new Promise((resolve, reject) => {
      if ((window as any).snap) { resolve(); return; }
      const existing = document.querySelector('script[data-midtrans-snap]');
      if (existing) {
        if ((window as any).snap) { resolve(); return; }
        existing.addEventListener('load', () => resolve());
        existing.addEventListener('error', reject);
        return;
      }
      const script = document.createElement('script');
      script.src = snapJsUrl;
      script.setAttribute('data-client-key', clientKey);
      script.setAttribute('data-midtrans-snap', 'true');
      script.onload = () => resolve();
      script.onerror = reject;
      document.body.appendChild(script);
    });

  const cartItems: CartItem[] = products
    .filter(p => (cart.get(p.id) || 0) > 0)
    .map(p => ({ product: p, quantity: cart.get(p.id)! }));

  const grossCartTotal = cartItems.reduce((sum, item) =>
    sum + getUnitPrice(item.product) * item.quantity, 0);

  /** Gift vouchers used first, then paid voucher balance, then cash/QRIS. */
  const voucherBreakdown = cartItems.map(item => {
    const available = productVouchers.get(item.product.id) ?? 0;
    const giftAvailable = productVouchersGift.get(item.product.id) ?? 0;
    // Product vouchers are a pre-pay instrument. Later-pay settlement charges
    // orders.total_amount, so auto-applying a voucher there would charge the
    // covered units again when the customer later pays the invoice.
    const byVoucher = isPrePay ? Math.min(item.quantity, available) : 0;
    const byGift = Math.min(byVoucher, giftAvailable);
    const byPaidVoucher = byVoucher - byGift;
    const byPayment = item.quantity - byVoucher;
    return { item, byVoucher, byGift, byPaidVoucher, byPayment };
  });

  const buildOrderItemsPayload = () =>
    voucherBreakdown.flatMap(vb => {
      const p = vb.item.product;
      const disc = p.is_refill && !isPrePay ? (freshDiscount || 0) : 0;
      // later_pay refill: store list price in unit_price and discount separately — backend totals use (unit_price - discount) per line.
      // Do not use getUnitPrice() here (it is already net); that would double-apply discount.
      const up = isPrePay
        ? getUnitPrice(p)
        : p.is_refill
          ? REFILL_BASE_PRICE
          : p.price;
      const rows: {
        product_id: string;
        product: string;
        is_refill: boolean;
        quantity: number;
        unit_price: number;
        discount: number;
      }[] = [];
      if (vb.byGift > 0) {
        rows.push({
          product_id: p.id,
          product: p.name,
          is_refill: p.is_refill,
          quantity: vb.byGift,
          unit_price: 0,
          discount: 0,
        });
      }
      if (vb.byPaidVoucher > 0) {
        rows.push({
          product_id: p.id,
          product: p.name,
          is_refill: p.is_refill,
          quantity: vb.byPaidVoucher,
          unit_price: up,
          discount: disc,
        });
      }
      if (vb.byPayment > 0) {
        rows.push({
          product_id: p.id,
          product: p.name,
          is_refill: p.is_refill,
          quantity: vb.byPayment,
          unit_price: up,
          discount: disc,
        });
      }
      return rows;
    });

  const computeOrderTotalFromRows = (
    rows: { quantity: number; unit_price: number; discount: number }[],
  ) => rows.reduce((s, r) => s + r.quantity * (r.unit_price - r.discount), 0);

  const orderTotalAmount = computeOrderTotalFromRows(buildOrderItemsPayload());

  const payableAmount = voucherBreakdown.reduce(
    (sum, { item, byPayment }) => sum + byPayment * getUnitPrice(item.product), 0
  );
  const hasEnoughVouchers = isPrePay ? payableAmount === 0 : true;

  const hasRefillInCart = cartItems.some(({ product }) => product.is_refill);
  const hasRefillGiftVoucherUse = voucherBreakdown.some(
    ({ item, byGift }) => item.product.is_refill && byGift > 0,
  );

  useEffect(() => {
    loadProducts();
    fetchFreshCustomerData();
  }, []);

  useEffect(() => {
    if (!serviceBranch || serviceBranch === 'Pending') {
      setBranchSchedule({ order_cutoff_hour: 16, closed_weekdays: [] });
      return;
    }
    supabase
      .from('branches')
      .select('order_cutoff_hour, closed_weekdays')
      .eq('name', serviceBranch)
      .maybeSingle()
      .then(({ data }) => {
        const sch = {
          order_cutoff_hour: data?.order_cutoff_hour ?? 16,
          closed_weekdays: Array.isArray(data?.closed_weekdays) ? [...(data!.closed_weekdays as number[])] : [],
        };
        setBranchSchedule(sch);
        if (!editOrderId) {
          setDeliveryDate(getMinimumDeliveryDate(new Date(), sch.order_cutoff_hour, sch.closed_weekdays));
        }
      });
  }, [serviceBranch, editOrderId]);

  const fetchFreshCustomerData = async () => {
    try {
      const token = sessionStorage.getItem('auth_token');
      if (!token) return;

      const [authResult, homeResult, ordersResult] = await Promise.all([
        supabase.functions.invoke('auth-validate-token', { body: { token } }),
        isPrePay
          ? Promise.resolve({ data: null, error: null })
          : supabase.functions.invoke('get-home-data', { body: { token } }),
        isPrePay || editOrderId
          ? Promise.resolve({ data: null, error: null })
          : supabase.functions.invoke('get-orders', { body: { token } }),
      ]);

      const { data, error } = authResult;
      if (error || !data?.success || !data.customer) return;

      const freshCustomer = data.customer as Customer;
      const homeData = homeResult.data;
      const currentPaymentTerm = homeData?.success
        ? homeData.payment_term || freshCustomer.payment_term || customer.payment_term || ''
        : freshCustomer.payment_term || customer.payment_term || '';

      setFreshDiscount(freshCustomer.discount || 0);
      setCreditLimit(homeData?.success ? homeData.credit_limit ?? null : freshCustomer.credit_limit ?? null);
      setPaymentTerm(currentPaymentTerm);
      setUnpaidCredit(homeData?.success ? homeData.unpaid_amount ?? 0 : 0);

      if (ordersResult.data?.success) {
        setBlockedByUnpaid(
          shouldBlockOutstanding(currentPaymentTerm, ordersResult.data.orders || []),
        );
      }

      sessionStorage.setItem(
        'customer',
        JSON.stringify({ ...customer, ...freshCustomer }),
      );
      window.dispatchEvent(new Event('session-auth-updated'));
    } catch {
      // silently fall back
    }
  };

  const fetchProductVouchers = async () => {
    try {
      const token = sessionStorage.getItem('auth_token');
      if (!token) return;
      const data = await loadCustomerVouchers(token);

      const map = new Map<string, number>();
      const giftMap = new Map<string, number>();
      for (const row of data) {
        map.set(row.product_id, row.balance);
        giftMap.set(row.product_id, row.gift_balance ?? 0);
      }
      setProductVouchers(map);
      setProductVouchersGift(giftMap);
    } catch {
      // silently fall back — no vouchers = empty map
    }
  };

  useEffect(() => {
    if (editOrderId && products.length > 0) {
      loadEditOrder(editOrderId);
    }
  }, [editOrderId, products]);

  // Sort: refill first → new gallon second → accessories last
  const getProductSortOrder = (name: string, is_refill: boolean): number => {
    const lower = name.toLowerCase();
    if (is_refill || lower.includes('refill')) return 0;
    if ((lower.includes('gallon') || lower.includes('galon')) && !lower.includes('rack')) return 1;
    return 2;
  };

  const loadProducts = async () => {
    try {
      const { data, error } = await supabase
        .from('products')
        .select('*')
        .eq('status', 'active');
      if (error) throw error;

      const filtered = (data || []).filter(p => {
        const lower = p.name.toLowerCase();
        if (isCustomerHiddenProduct(lower)) return false;
        if (lower.includes('test') && customer.branch !== 'Demo') return false;
        return true;
      });

      filtered.sort((a, b) => {
        const fa = isFeaturedRefill19Liter(a) ? 0 : 1;
        const fb = isFeaturedRefill19Liter(b) ? 0 : 1;
        if (fa !== fb) return fa - fb;
        const o =
          getProductSortOrder(a.name, a.is_refill) - getProductSortOrder(b.name, b.is_refill);
        if (o !== 0) return o;
        return a.name.localeCompare(b.name);
      });

      setProducts(filtered);
    } catch (err: any) {
      setError(t('placeOrder.failedLoadProducts') + err.message);
    } finally {
      setLoading(false);
      // Fetch vouchers after products loaded
      fetchProductVouchers();
    }
  };

  const loadEditOrder = async (orderId: string) => {
    try {
      const token = sessionStorage.getItem('auth_token');
      if (!token) throw new Error('Session expired');

      const { data, error } = await supabase.functions.invoke('get-orders', {
        body: { token, order_id: orderId },
      });

      if (error) throw new Error(error.message);
      if (!data?.success) throw new Error(data?.error || 'Failed to load order');

      const order = data.order;
      if (typeof order.branch === 'string' && order.branch.trim()) {
        setEditOrderBranch({ orderId, branch: order.branch });
      }
      setDeliveryDate(order.delivery_date);
      setNotes(order.note ?? order.delivery_notes ?? '');

      const newCart = new Map<string, number>();
      for (const item of order.order_items || []) {
        const matched = products.find(p => p.id === item.product_id)
          ?? products.find(p => p.name === item.product);
        if (matched) {
          const prev = newCart.get(matched.id) || 0;
          newCart.set(matched.id, prev + item.quantity);
        }
      }
      setCart(newCart);
    } catch (err: any) {
      setError(t('placeOrder.failedLoadOrder') + err.message);
    }
  };

  const updateCart = (productId: string, delta: number) => {
    setCart(prev => {
      const next = new Map(prev);
      const current = next.get(productId) || 0;
      const newVal = Math.max(0, current + delta);
      if (newVal === 0) {
        next.delete(productId);
      } else {
        next.set(productId, newVal);
      }
      return next;
    });
  };


  const handleDeliveryDateChange = (value: string) => {
    if (!branchSchedule) {
      setDeliveryDate(value);
      return;
    }
    const min = getMinimumDeliveryDate(
      new Date(),
      branchSchedule.order_cutoff_hour,
      branchSchedule.closed_weekdays,
    );
    if (value < min) {
      toast.error(t('placeOrder.deliveryDateTooSoon'));
      setDeliveryDate(min);
      return;
    }
    if (isWeekdayClosed(value, branchSchedule.closed_weekdays)) {
      toast.error(t('placeOrder.deliveryDateBranchClosed'));
      setDeliveryDate(snapToNextOpenDay(value, branchSchedule.closed_weekdays));
      return;
    }
    setDeliveryDate(value);
  };

  const handleSubmit = async () => {
    if (cartItems.length === 0) {
      setError(t('placeOrder.selectProductError'));
      return;
    }
    if (!deliveryDate) {
      setError(t('placeOrder.selectDateError'));
      return;
    }
    if (branchSchedule) {
      const min = getMinimumDeliveryDate(
        new Date(),
        branchSchedule.order_cutoff_hour,
        branchSchedule.closed_weekdays,
      );
      if (deliveryDate < min) {
        setError('DELIVERY_DATE_TOO_SOON');
        return;
      }
      if (isWeekdayClosed(deliveryDate, branchSchedule.closed_weekdays)) {
        setError('DELIVERY_DATE_BRANCH_CLOSED');
        return;
      }
    }

    setSubmitting(true);
    setError('');

    try {
      const token = sessionStorage.getItem('auth_token');
      if (!token) throw new Error('Session expired, please login again');

      let orderItems = buildOrderItemsPayload();
      const orderTotalAmount = computeOrderTotalFromRows(orderItems);

      // Credit limit check for later_pay (frontend guard)
      if (!isPrePay && !editOrderId && creditLimit !== null) {
        if (unpaidCredit + payableAmount > creditLimit) {
          setError('CREDIT_LIMIT_EXCEEDED');
          setSubmitting(false);
          return;
        }
      }

      // Product vouchers are a pre-pay-only checkout instrument.
      const calculatedProductDeductions = voucherBreakdown
        .filter(({ byVoucher }) => byVoucher > 0)
        .map(({ item, byVoucher }) => ({ product_id: item.product.id, quantity: byVoucher }))
        .sort((a, b) => a.product_id.localeCompare(b.product_id));

      let voucherOrderKey: string | undefined;
      let laterPayOrderKey: string | undefined;
      let product_deductions = calculatedProductDeductions;
      let clearVoucherOrderKey: (() => void) | null = null;
      let clearLaterPayOrderKey: (() => void) | null = null;

      if (!isPrePay && !editOrderId) {
        const fingerprint = await sha256Hex(JSON.stringify({
          delivery_date: deliveryDate,
          note: notes.trim() || null,
          items: cartItems
            .map(({ product, quantity }) => ({ product_id: product.id, quantity }))
            .sort((a, b) => a.product_id.localeCompare(b.product_id)),
        }));
        const storageKey = `vividaqua:later-pay-order:${customer.id}`;

        const readStoredOrder = (): StoredLaterPayOrder | null => {
          const raw = localStorage.getItem(storageKey);
          if (!raw) return null;
          const parsed = JSON.parse(raw) as Partial<StoredLaterPayOrder>;
          if (
            typeof parsed.orderKey !== 'string' ||
            !UUID_RE.test(parsed.orderKey) ||
            typeof parsed.fingerprint !== 'string' ||
            !Array.isArray(parsed.items) ||
            parsed.items.length === 0 ||
            !parsed.items.every((row) =>
              row &&
              typeof row.product_id === 'string' &&
              UUID_RE.test(row.product_id) &&
              typeof row.product === 'string' &&
              row.product.trim().length > 0 &&
              typeof row.is_refill === 'boolean' &&
              Number.isSafeInteger(row.quantity) && row.quantity > 0 &&
              Number.isSafeInteger(row.unit_price) && row.unit_price >= 0 &&
              Number.isSafeInteger(row.discount) && row.discount >= 0
            ) ||
            !Array.isArray(parsed.productDeductions) ||
            !parsed.productDeductions.every((row) =>
              row &&
              typeof row.product_id === 'string' &&
              UUID_RE.test(row.product_id) &&
              Number.isSafeInteger(row.quantity) &&
              row.quantity > 0
            )
          ) {
            throw new Error(LATER_PAY_ORDER_STORAGE_MESSAGE);
          }
          return {
            orderKey: parsed.orderKey.toLowerCase(),
            fingerprint: parsed.fingerprint,
            items: parsed.items.map((row) => ({
              ...row,
              product_id: row.product_id.toLowerCase(),
            })),
            productDeductions: parsed.productDeductions.map((row) => ({
              product_id: row.product_id.toLowerCase(),
              quantity: row.quantity,
            })),
          };
        };

        const selectLaterPayOrder = (): StoredLaterPayOrder => {
          const persistedOrder = readStoredOrder();
          if (persistedOrder) {
            if (persistedOrder.fingerprint !== fingerprint) {
              throw new Error(LATER_PAY_ORDER_IN_USE_MESSAGE);
            }
            return persistedOrder;
          }

          const memoryOrder = inMemoryLaterPayOrder.current;
          if (memoryOrder && memoryOrder.fingerprint !== fingerprint) {
            throw new Error(LATER_PAY_ORDER_IN_USE_MESSAGE);
          }

          const selectedOrder = memoryOrder || {
            orderKey: createCheckoutKey(),
            fingerprint,
            items: orderItems,
            productDeductions: calculatedProductDeductions,
          };
          localStorage.setItem(storageKey, JSON.stringify(selectedOrder));
          const durableOrder = readStoredOrder();
          if (durableOrder?.orderKey !== selectedOrder.orderKey) {
            throw new Error(LATER_PAY_ORDER_STORAGE_MESSAGE);
          }
          return durableOrder;
        };

        const lockManager = navigator.locks;
        if (!lockManager) throw new Error(LATER_PAY_ORDER_STORAGE_MESSAGE);

        let storedOrder: StoredLaterPayOrder;
        try {
          storedOrder = await lockManager.request(
            `vividaqua:later-pay-order:${customer.id}:lock`,
            { mode: 'exclusive' },
            selectLaterPayOrder,
          );
        } catch (storageError) {
          if (
            storageError instanceof Error &&
            (
              storageError.message === LATER_PAY_ORDER_IN_USE_MESSAGE ||
              storageError.message === LATER_PAY_ORDER_STORAGE_MESSAGE
            )
          ) {
            throw storageError;
          }
          throw new Error(LATER_PAY_ORDER_STORAGE_MESSAGE);
        }

        inMemoryLaterPayOrder.current = storedOrder;
        laterPayOrderKey = storedOrder.orderKey;
        orderItems = storedOrder.items;
        product_deductions = storedOrder.productDeductions;
        clearLaterPayOrderKey = () => {
          if (inMemoryLaterPayOrder.current?.orderKey === storedOrder.orderKey) {
            inMemoryLaterPayOrder.current = null;
          }
          try {
            const current = readStoredOrder();
            if (current?.orderKey === storedOrder.orderKey) {
              localStorage.removeItem(storageKey);
            }
          } catch {
            // A malformed or unavailable store is safer left untouched.
          }
        };
      }

      if (isPrePay && !editOrderId) {
        const fingerprint = await sha256Hex(JSON.stringify({
          delivery_date: deliveryDate,
          note: notes.trim() || null,
          items: cartItems
            .map(({ product, quantity }) => ({ product_id: product.id, quantity }))
            .sort((a, b) => a.product_id.localeCompare(b.product_id)),
        }));
        const storageKey = `vividaqua:voucher-only-order:${customer.id}`;
        const qrisStorageKey = `vividaqua:prepay-checkout:${customer.id}`;

        const readStoredOrder = (): StoredVoucherOnlyOrder | null => {
          const raw = localStorage.getItem(storageKey);
          if (!raw) return null;
          const parsed = JSON.parse(raw) as Partial<StoredVoucherOnlyOrder>;
          if (
            typeof parsed.orderKey !== 'string' ||
            !UUID_RE.test(parsed.orderKey) ||
            typeof parsed.fingerprint !== 'string' ||
            !Array.isArray(parsed.productDeductions) ||
            !parsed.productDeductions.every((row) =>
              row &&
              typeof row.product_id === 'string' &&
              UUID_RE.test(row.product_id) &&
              Number.isSafeInteger(row.quantity) &&
              row.quantity > 0
            )
          ) {
            throw new Error(PREPAY_CHECKOUT_STORAGE_MESSAGE);
          }
          return {
            orderKey: parsed.orderKey.toLowerCase(),
            fingerprint: parsed.fingerprint,
            productDeductions: parsed.productDeductions.map((row) => ({
              product_id: row.product_id.toLowerCase(),
              quantity: row.quantity,
            })),
          };
        };

        const selectVoucherOrder = (): StoredVoucherOnlyOrder => {
          if (localStorage.getItem(qrisStorageKey)) {
            throw new Error(PREPAY_CHECKOUT_IN_USE_MESSAGE);
          }

          const persistedOrder = readStoredOrder();
          if (persistedOrder) {
            if (persistedOrder.fingerprint !== fingerprint) {
              throw new Error(PREPAY_CHECKOUT_IN_USE_MESSAGE);
            }
            return persistedOrder;
          }

          const memoryOrder = inMemoryVoucherOnlyOrder.current;
          if (memoryOrder && memoryOrder.fingerprint !== fingerprint) {
            throw new Error(PREPAY_CHECKOUT_IN_USE_MESSAGE);
          }
          if (!memoryOrder && payableAmount > 0) {
            throw new Error('PRE_PAY_REQUIRES_PAYMENT');
          }

          const selectedOrder = memoryOrder || {
            orderKey: createCheckoutKey(),
            fingerprint,
            productDeductions: calculatedProductDeductions,
          };
          localStorage.setItem(storageKey, JSON.stringify(selectedOrder));
          const durableOrder = readStoredOrder();
          if (durableOrder?.orderKey !== selectedOrder.orderKey) {
            throw new Error(PREPAY_CHECKOUT_STORAGE_MESSAGE);
          }
          return durableOrder;
        };

        const lockManager = navigator.locks;
        if (!lockManager) throw new Error(PREPAY_CHECKOUT_STORAGE_MESSAGE);

        let storedOrder: StoredVoucherOnlyOrder;
        try {
          storedOrder = await lockManager.request(
            `vividaqua:prepay-order:${customer.id}:lock`,
            { mode: 'exclusive' },
            selectVoucherOrder,
          );
        } catch (storageError) {
          if (
            storageError instanceof Error &&
            (
              storageError.message === PREPAY_CHECKOUT_IN_USE_MESSAGE ||
              storageError.message === PREPAY_CHECKOUT_STORAGE_MESSAGE ||
              storageError.message === 'PRE_PAY_REQUIRES_PAYMENT'
            )
          ) {
            throw storageError;
          }
          throw new Error(PREPAY_CHECKOUT_STORAGE_MESSAGE);
        }

        inMemoryVoucherOnlyOrder.current = storedOrder;
        voucherOrderKey = storedOrder.orderKey;
        product_deductions = storedOrder.productDeductions;
        clearVoucherOrderKey = () => {
          if (inMemoryVoucherOnlyOrder.current?.orderKey === storedOrder.orderKey) {
            inMemoryVoucherOnlyOrder.current = null;
          }
          try {
            const current = readStoredOrder();
            if (current?.orderKey === storedOrder.orderKey) {
              localStorage.removeItem(storageKey);
            }
          } catch {
            // A malformed or unavailable store is safer left untouched.
          }
        };
      }

      const { data, error } = await supabase.functions.invoke('submit-order', {
        body: {
          token,
          order: {
            delivery_date: deliveryDate,
            note: notes || null,
            total_amount: orderTotalAmount,
            payment_status: payableAmount === 0 ? 'paid' : 'unpaid',
          },
          items: orderItems,
          product_deductions,
          edit_order_id: editOrderId || undefined,
          voucher_order_key: voucherOrderKey,
          later_pay_order_key: laterPayOrderKey,
        },
      });

      if (error) throw new Error(error.message);
      if (data?.voucher_order_disposition === 'discard_key') {
        clearVoucherOrderKey?.();
      }
      if (data?.later_pay_order_disposition === 'discard_key') {
        clearLaterPayOrderKey?.();
      }
      if (!data?.success) {
        if (data?.error === 'UNPAID_ORDERS' || data?.error === 'OUTSTANDING_PAYMENT_BLOCKED') {
          setError('UNPAID_ORDERS');
          return;
        }
        if (data?.error === 'PRE_PAY_REQUIRES_PAYMENT') {
          setError('PRE_PAY_REQUIRES_PAYMENT');
          return;
        }
        if (data?.error === 'CREDIT_LIMIT_EXCEEDED') {
          setError('CREDIT_LIMIT_EXCEEDED');
          return;
        }
        if (data?.error === 'DELIVERY_DATE_TOO_SOON') {
          setError('DELIVERY_DATE_TOO_SOON');
          return;
        }
        if (data?.error === 'DELIVERY_DATE_BRANCH_CLOSED') {
          setError('DELIVERY_DATE_BRANCH_CLOSED');
          return;
        }
        if (data?.error === 'ORDER_NOT_EDITABLE') {
          setError('ORDER_NOT_EDITABLE');
          return;
        }
        if (data?.error === 'VOUCHER_ORDER_EDIT_NOT_SUPPORTED') {
          setError('VOUCHER_ORDER_EDIT_NOT_SUPPORTED');
          return;
        }
        throw new Error(data?.error || 'Unknown error');
      }

      clearVoucherOrderKey?.();
      clearLaterPayOrderKey?.();
      if (!editOrderId) await fetchProductVouchers();

      setShowSuccess(true);
    } catch (err: any) {
      setError('Failed to submit: ' + err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handlePayWithQris = async () => {
    if (cartItems.length === 0) { setError(t('placeOrder.selectProductError')); return; }
    if (!deliveryDate) { setError(t('placeOrder.selectDateError')); return; }
    if (branchSchedule) {
      const min = getMinimumDeliveryDate(
        new Date(),
        branchSchedule.order_cutoff_hour,
        branchSchedule.closed_weekdays,
      );
      if (deliveryDate < min) {
        setError('DELIVERY_DATE_TOO_SOON');
        return;
      }
      if (isWeekdayClosed(deliveryDate, branchSchedule.closed_weekdays)) {
        setError('DELIVERY_DATE_BRANCH_CLOSED');
        return;
      }
    }

    setSubmitting(true);
    setError('');
    try {
      const token = sessionStorage.getItem('auth_token');
      if (!token) throw new Error('Session expired, please login again');

      const orderItems = buildOrderItemsPayload();
      const orderTotalAmount = computeOrderTotalFromRows(orderItems);

      const calculatedProductDeductions = voucherBreakdown
        .filter(({ byVoucher }) => byVoucher > 0)
        .map(({ item, byVoucher }) => ({ product_id: item.product.id, quantity: byVoucher }))
        .sort((a, b) => a.product_id.localeCompare(b.product_id));

      // Voucher balances change as soon as the checkout reserves them. Keep the
      // fingerprint tied to customer intent, then reuse the original deduction
      // split from storage so a reload cannot create a second reservation.
      const fingerprint = await sha256Hex(JSON.stringify({
        delivery_date: deliveryDate,
        note: notes.trim() || null,
        items: cartItems
          .map(({ product, quantity }) => ({ product_id: product.id, quantity }))
          .sort((a, b) => a.product_id.localeCompare(b.product_id)),
      }));
      const storageKey = `vividaqua:prepay-checkout:${customer.id}`;
      const voucherOrderStorageKey = `vividaqua:voucher-only-order:${customer.id}`;

      const readStoredCheckout = (): StoredPrepayCheckout | null => {
        const raw = localStorage.getItem(storageKey);
        if (!raw) return null;

        const parsed = JSON.parse(raw) as Partial<StoredPrepayCheckout>;
        if (
          typeof parsed.checkoutKey !== 'string' ||
          !UUID_RE.test(parsed.checkoutKey) ||
          typeof parsed.fingerprint !== 'string' ||
          !Array.isArray(parsed.productDeductions) ||
          !parsed.productDeductions.every((row) =>
            row &&
            typeof row.product_id === 'string' &&
            UUID_RE.test(row.product_id) &&
            Number.isSafeInteger(row.quantity) &&
            row.quantity > 0
          )
        ) {
          throw new Error(PREPAY_CHECKOUT_STORAGE_MESSAGE);
        }

        return {
          checkoutKey: parsed.checkoutKey.toLowerCase(),
          fingerprint: parsed.fingerprint,
          productDeductions: parsed.productDeductions.map((row) => ({
            product_id: row.product_id.toLowerCase(),
            quantity: row.quantity,
          })),
        };
      };

      const selectCheckout = (): StoredPrepayCheckout => {
        if (localStorage.getItem(voucherOrderStorageKey)) {
          throw new Error(PREPAY_CHECKOUT_IN_USE_MESSAGE);
        }
        const persistedCheckout = readStoredCheckout();
        if (persistedCheckout) {
          if (persistedCheckout.fingerprint !== fingerprint) {
            throw new Error(PREPAY_CHECKOUT_IN_USE_MESSAGE);
          }
          return persistedCheckout;
        }

        const memoryCheckout = inMemoryPrepayCheckout.current;
        if (memoryCheckout?.fingerprint !== undefined && memoryCheckout.fingerprint !== fingerprint) {
          throw new Error(PREPAY_CHECKOUT_IN_USE_MESSAGE);
        }

        const checkout = memoryCheckout || {
          checkoutKey: createCheckoutKey(),
          fingerprint,
          productDeductions: calculatedProductDeductions,
        };
        localStorage.setItem(storageKey, JSON.stringify(checkout));

        // Verify ownership while the cross-tab lock is still held. Never send
        // a request whose retry key is not the durable customer checkout key.
        const durableCheckout = readStoredCheckout();
        if (durableCheckout?.checkoutKey !== checkout.checkoutKey) {
          throw new Error(PREPAY_CHECKOUT_STORAGE_MESSAGE);
        }
        return durableCheckout;
      };

      const lockManager = navigator.locks;
      if (!lockManager) throw new Error(PREPAY_CHECKOUT_STORAGE_MESSAGE);

      let storedCheckout: StoredPrepayCheckout;
      try {
        storedCheckout = await lockManager.request(
          `vividaqua:prepay-order:${customer.id}:lock`,
          { mode: 'exclusive' },
          selectCheckout,
        );
      } catch (storageError) {
        if (
          storageError instanceof Error &&
          (
            storageError.message === PREPAY_CHECKOUT_IN_USE_MESSAGE ||
            storageError.message === PREPAY_CHECKOUT_STORAGE_MESSAGE
          )
        ) {
          throw storageError;
        }
        throw new Error(PREPAY_CHECKOUT_STORAGE_MESSAGE);
      }
      inMemoryPrepayCheckout.current = storedCheckout;
      const checkoutKey = storedCheckout.checkoutKey;
      const product_deductions = storedCheckout.productDeductions;

      const clearCheckoutKey = () => {
        if (inMemoryPrepayCheckout.current?.checkoutKey === checkoutKey) {
          inMemoryPrepayCheckout.current = null;
        }
        try {
          const raw = localStorage.getItem(storageKey);
          const parsed = raw ? JSON.parse(raw) as Partial<StoredPrepayCheckout> : null;
          if (parsed?.checkoutKey === checkoutKey) localStorage.removeItem(storageKey);
        } catch {
          // Nothing else to clear when storage is unavailable.
        }
      };

      const prepayRequestBody = {
        token,
        checkout_key: checkoutKey,
        order: { delivery_date: deliveryDate, note: notes || null, total_amount: orderTotalAmount },
        items: orderItems,
        payment_amount: payableAmount,
        product_deductions,
      };
      const { data, error } = await supabase.functions.invoke('submit-prepay-order', {
        body: prepayRequestBody,
      });

      if (error) throw new Error(error.message);
      if (data?.checkout_disposition === 'discard_key') {
        clearCheckoutKey();
      }
      if (!data?.success) {
        if (data?.error === 'DELIVERY_DATE_TOO_SOON') {
          setError('DELIVERY_DATE_TOO_SOON');
          setSubmitting(false);
          return;
        }
        if (data?.error === 'DELIVERY_DATE_BRANCH_CLOSED') {
          setError('DELIVERY_DATE_BRANCH_CLOSED');
          setSubmitting(false);
          return;
        }
        if (data?.checkout_disposition === 'manual_reconcile') {
          throw new Error(
            `Payment status requires manual review. Do not start another checkout; contact support with reference ${data?.midtrans_order_id || checkoutKey}.`,
          );
        }
        if (data?.checkout_disposition === 'retry_same_key') {
          throw new Error(
            `Payment status is not final. Retry this exact order; its checkout key has been kept. (${data?.error || 'UNKNOWN_STATUS'})`,
          );
        }
        throw new Error(data?.error || 'Failed to create payment');
      }

      if (data.paid === true) {
        setShowSuccess(true);
        setSubmitting(false);
        return;
      }

      await loadSnapScript(data.client_key, data.snap_js_url);

      const midtransOrderId = data.midtrans_order_id;
      let paymentCompleted = false;
      (window as any).snap.pay(data.snap_token, {
        onSuccess: async () => {
          paymentCompleted = true;
          try {
            const { data: confirmation, error: confirmationError } = await supabase.functions.invoke('confirm-snap-payment', {
              body: { token, midtrans_order_id: midtransOrderId },
            });
            if (confirmationError) throw new Error(confirmationError.message);
            if (!confirmation?.success || !confirmation?.paid) {
              throw new Error(confirmation?.error || 'PAYMENT_NOT_VERIFIED');
            }

            // Ask the idempotent checkout endpoint for its explicit terminal
            // disposition. If that follow-up is interrupted, retain the key so
            // the same checkout can be reconciled on a later retry.
            try {
              const { data: resolvedCheckout } = await supabase.functions.invoke(
                'submit-prepay-order',
                { body: prepayRequestBody },
              );
              if (resolvedCheckout?.checkout_disposition === 'discard_key') {
                clearCheckoutKey();
              }
            } catch {
              // Payment is already verified; retaining the key is the safe
              // fallback when terminal cleanup cannot be confirmed.
            }
            setShowSuccess(true);
          } catch (confirmationError: any) {
            setError(`${t('placeOrder.paymentFailedPrefix')}${confirmationError?.message || 'PAYMENT_NOT_VERIFIED'}`);
          } finally {
            setSubmitting(false);
          }
        },
        onPending: () => {
          paymentCompleted = true;
          setSubmitting(false);
          toast(t('placeOrder.paymentPendingToast'), { duration: 6000 });
          navigate('/customer-home');
        },
        onError: (result: any) => {
          paymentCompleted = true;
          setSubmitting(false);
          setError(`${t('placeOrder.paymentFailedPrefix')}${result?.status_message || t('common.error')}`);
        },
        onClose: () => {
          setSubmitting(false);
          if (!paymentCompleted) {
            toast(t('placeOrder.paymentNotCompletedToast'), { duration: 6000 });
          }
        },
      });
    } catch (err: any) {
      setSubmitting(false);
      setError('Failed to submit: ' + err.message);
    }
  };

  const minDeliveryYmd = branchSchedule
    ? getMinimumDeliveryDate(new Date(), branchSchedule.order_cutoff_hour, branchSchedule.closed_weekdays)
    : getMinimumDeliveryDate(new Date(), 16, []);

  const wdShort =
    language === 'en'
      ? ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
      : ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];
  const closedDayLabels =
    branchSchedule && branchSchedule.closed_weekdays.length > 0
      ? [...branchSchedule.closed_weekdays].sort((a, b) => a - b).map((w) => wdShort[w]).join(', ')
      : '';

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', background: tokens.pageBg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center', color: tokens.text }}>
          <div style={{ width: '40px', height: '40px', border: `4px solid ${tokens.primaryBorder}`, borderTop: `4px solid ${tokens.primary}`, borderRadius: '50%', margin: '0 auto 16px', animation: 'spin 1s linear infinite' }} />
          <p>{t('placeOrder.loadingProducts')}</p>
          <style>{`@keyframes spin { 0%{transform:rotate(0deg)} 100%{transform:rotate(360deg)} }`}</style>
        </div>
      </div>
    );
  }

  if (showSuccess) {
    return (
      <div style={{ minHeight: '100vh', background: tokens.pageBg, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
        <div style={{ background: tokens.card, borderRadius: '20px', padding: '40px', maxWidth: '400px', width: '100%', textAlign: 'center', boxShadow: '0 10px 40px rgba(0,0,0,0.2)', backdropFilter: tokens.cardBlur, WebkitBackdropFilter: tokens.cardBlur, border: `1px solid ${tokens.primaryBorder}` }}>
          <div style={{ fontSize: '64px', marginBottom: '16px' }}>✅</div>
          <h2 style={{ fontSize: '22px', color: tokens.text, margin: '0 0 10px 0' }}>
            {editOrderId ? t('placeOrder.orderUpdated') : t('placeOrder.orderPlaced')}
          </h2>
          <p style={{ color: tokens.muted, fontSize: '14px', margin: '0 0 24px 0' }}>
            {editOrderId
              ? t('placeOrder.orderUpdatedDesc')
              : t('placeOrder.orderPlacedDesc')}
          </p>
          <button
            onClick={() => navigate('/customer-home')}
            style={{ width: '100%', padding: '14px', background: tokens.gradientPrimary, color: 'white', border: 'none', borderRadius: '10px', fontSize: '16px', fontWeight: 'bold', cursor: 'pointer' }}
          >
            {t('placeOrder.backToHome')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: tokens.pageBg, padding: '14px', paddingBottom: '88px' }}>

      {/* Header */}
      <div style={{ maxWidth: '800px', margin: '0 auto 6px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: tokens.topBarGradient, border: `1px solid ${tokens.cardBorder}`, borderRadius: '16px', padding: '10px 14px', boxShadow: '0 4px 16px rgba(0,105,113,0.2)' }}>
        <button
          onClick={() => navigate('/customer-home')}
          style={{ padding: '8px 16px', background: 'rgba(255,255,255,0.15)', color: 'white', border: '1px solid rgba(255,255,255,0.3)', borderRadius: '8px', fontSize: '14px', fontWeight: 'bold', cursor: 'pointer' }}
        >
          ← {t('common.back')}
        </button>
        <h1 style={{ color: 'white', fontSize: '20px', margin: 0, textShadow: '0 1px 4px rgba(0,0,0,0.4)' }}>
          {editOrderId ? `✏️ ${t('placeOrder.editOrder')}` : `🛒 ${t('placeOrder.newDelivery')}`}
        </h1>
        <div style={{ width: '80px', display: 'flex', justifyContent: 'flex-end', alignItems: 'center' }}>
          <LanguageSwitcher />
        </div>
      </div>

      <div style={{ maxWidth: '800px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '6px' }}>

        {/* Unpaid orders block — daily later_pay */}
        {blockedByUnpaid && (
          <div style={{ background: '#fdecea', border: `2px solid ${theme.error}`, borderRadius: '16px', padding: '20px' }}>
            <p style={{ margin: '0 0 8px 0', fontWeight: '700', color: theme.error, fontSize: '16px' }}>🚫 {t('placeOrder.outstandingBalance')}</p>
            <p style={{ margin: '0 0 16px 0', fontSize: '14px', color: theme.error }}>
              {t('placeOrder.outstandingDesc')}
            </p>
            <button
              onClick={() => navigate('/orders')}
              style={{ padding: '12px 24px', background: tokens.gradientPrimary, color: 'white', border: 'none', borderRadius: '8px', fontSize: '14px', fontWeight: 'bold', cursor: 'pointer' }}
            >
              💳 {t('placeOrder.viewPayBills')}
            </button>
          </div>
        )}

        {/* Voucher summary banner (pre_pay only) */}
        {isPrePay && productVouchers.size > 0 && (
          <div style={{ background: tokens.card, borderRadius: '16px', padding: '16px 20px', boxShadow: '0 4px 20px rgba(0,0,0,0.15)', backdropFilter: tokens.cardBlur, WebkitBackdropFilter: tokens.cardBlur, border: `1px solid ${tokens.primaryBorder}` }}>
            <p style={{ fontSize: '13px', fontWeight: '600', color: tokens.muted, margin: '0 0 10px 0' }}>🎫 {t('account.voucherBalance')}</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {products
                .filter(p => productVouchers.has(p.id))
                .map(p => (
                  <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}>
                    <span style={{ color: tokens.text }}>{p.name}</span>
                    <span style={{ fontWeight: 'bold', color: (productVouchers.get(p.id) ?? 0) > 0 ? tokens.primary : theme.error }}>
                      {productVouchers.get(p.id) ?? 0}
                    </span>
                  </div>
                ))}
            </div>
          </div>
        )}

        {/* Delivery schedule notice */}
        {showScheduleNotice && branchSchedule && (
          <div
            style={{
              background: isDark ? 'rgba(255,193,7,0.12)' : '#fff8e1',
              border: `2px solid ${theme.warning}`,
              borderRadius: '16px',
              padding: '16px 18px',
              fontSize: '13px',
              color: tokens.text,
              lineHeight: 1.55,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px' }}>
              <div>
                <p style={{ margin: '0 0 8px 0', fontWeight: '700', fontSize: '14px' }}>ℹ️ {t('placeOrder.deliveryScheduleTitle')}</p>
                <p style={{ margin: '0 0 6px 0' }}>
                  {t('placeOrder.deliveryCutoffLine').replace('{hour}', String(branchSchedule.order_cutoff_hour))}
                </p>
                <p style={{ margin: 0 }}>
                  {branchSchedule.closed_weekdays.length > 0
                    ? t('placeOrder.deliveryRestDaysLine').replace('{days}', closedDayLabels)
                    : t('placeOrder.deliveryRestDaysNone')}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowScheduleNotice(false)}
                style={{
                  flexShrink: 0,
                  padding: '6px 12px',
                  fontSize: '12px',
                  fontWeight: 600,
                  border: `1px solid ${tokens.primary}`,
                  borderRadius: '8px',
                  background: 'transparent',
                  color: tokens.primary,
                  cursor: 'pointer',
                }}
              >
                {t('placeOrder.dismissNotice')}
              </button>
            </div>
          </div>
        )}

        {/* Delivery Date */}
        <div style={{ background: tokens.card, borderRadius: '16px', padding: '20px', boxShadow: '0 4px 20px rgba(0,0,0,0.15)', backdropFilter: tokens.cardBlur, WebkitBackdropFilter: tokens.cardBlur, border: `1px solid ${tokens.primaryBorder}` }}>
          <label style={{ fontSize: '14px', fontWeight: '600', color: tokens.text, display: 'block', marginBottom: '10px' }}>
            📅 {t('placeOrder.deliveryDate')}
          </label>
          <input
            type="date"
            value={deliveryDate}
            min={minDeliveryYmd}
            onChange={e => handleDeliveryDateChange(e.target.value)}
            style={{ width: '100%', padding: '12px', fontSize: '16px', border: `2px solid ${tokens.primary}`, borderRadius: '8px', outline: 'none', boxSizing: 'border-box', background: tokens.inputBg, color: tokens.text, colorScheme: isDark ? 'dark' : 'light' }}
          />
        </div>

        {/* Products */}
        <div style={{ background: tokens.card, borderRadius: '16px', padding: '20px', boxShadow: '0 4px 20px rgba(0,0,0,0.15)', backdropFilter: tokens.cardBlur, WebkitBackdropFilter: tokens.cardBlur, border: `1px solid ${tokens.primaryBorder}` }}>
          <p style={{ fontSize: '14px', fontWeight: '600', color: tokens.text, margin: '0 0 16px 0' }}>🛍️ {t('placeOrder.selectProducts')}</p>
          {products.length === 0 ? (
            <p style={{ color: tokens.muted, textAlign: 'center', padding: '20px 0' }}>{t('placeOrder.noProducts')}</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
              {/* Main products */}
              {products.filter(p => !isAccessory(p)).map((product, idx, arr) => {
                const qty = cart.get(product.id) || 0;
                const unitPrice = getUnitPrice(product);
                const plusDisabled = false;

                return (
                  <Fragment key={product.id}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px', background: qty > 0 ? tokens.primaryBg : 'transparent', borderRadius: qty > 0 ? '10px' : '0', border: qty > 0 ? `2px solid ${tokens.primary}` : 'none', margin: qty > 0 ? '4px 0' : '0' }}>
                    <div style={{ flex: 1 }}>
                      <p style={{ margin: 0, fontWeight: '600', fontSize: '14px', color: tokens.text }}>{product.name}</p>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '2px', flexWrap: 'wrap' }}>
                        <span style={{ fontSize: '13px', color: tokens.muted }}>
                          {formatCurrency(unitPrice)} / {product.unit}
                          {!isPrePay && product.is_refill && freshDiscount > 0 && (
                            <span style={{ marginLeft: '6px', color: theme.success, fontSize: '11px' }}>
                              (disc. {formatCurrency(freshDiscount)})
                            </span>
                          )}
                        </span>
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <button
                        onClick={() => updateCart(product.id, -1)}
                        disabled={qty === 0}
                        style={{ width: '32px', height: '32px', borderRadius: '50%', border: 'none', background: qty > 0 ? tokens.primary : isDark ? 'rgba(255,255,255,0.12)' : '#ddd', color: 'white', fontSize: '18px', fontWeight: 'bold', cursor: qty > 0 ? 'pointer' : 'not-allowed', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                      >
                        −
                      </button>
                      <span style={{ width: '28px', textAlign: 'center', fontWeight: 'bold', fontSize: '16px' }}>{qty}</span>
                      <button
                        onClick={() => updateCart(product.id, 1)}
                        disabled={plusDisabled}
                        style={{ width: '32px', height: '32px', borderRadius: '50%', border: 'none', background: plusDisabled ? isDark ? 'rgba(255,255,255,0.12)' : '#ddd' : tokens.primary, color: 'white', fontSize: '18px', fontWeight: 'bold', cursor: plusDisabled ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                      >
                        +
                      </button>
                    </div>
                  </div>
                  {idx < arr.length - 1 && (
                    <div style={{ height: 1, background: tokens.divider, margin: '0 4px' }} />
                  )}
                  </Fragment>
                );
              })}

              {/* Accessories toggle */}
              {products.some(p => isAccessory(p)) && (
                <>
                  <button
                    onClick={() => setShowAccessories(v => !v)}
                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', padding: '10px 14px', background: tokens.primaryBg, border: `1px dashed ${tokens.primary}`, borderRadius: '10px', cursor: 'pointer', fontSize: '13px', fontWeight: '600', color: tokens.primary }}
                  >
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                      <Package2 size={18} strokeWidth={2.25} aria-hidden />
                      {t('placeOrder.accessories')}
                    </span>
                    <span>{showAccessories ? t('placeOrder.hideAccessories') : t('placeOrder.showAccessories')} {showAccessories ? '▲' : '▼'}</span>
                  </button>

                  {showAccessories && products.filter(p => isAccessory(p)).map((product, idx, arr) => {
                    const qty = cart.get(product.id) || 0;
                    const unitPrice = getUnitPrice(product);
                    const plusDisabled = false;

                    return (
                      <Fragment key={product.id}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px', background: qty > 0 ? tokens.primaryBg : 'transparent', borderRadius: qty > 0 ? '10px' : '0', border: qty > 0 ? `2px solid ${tokens.primary}` : 'none', margin: qty > 0 ? '4px 0' : '0' }}>
                        <div style={{ flex: 1 }}>
                          <p style={{ margin: 0, fontWeight: '600', fontSize: '14px', color: tokens.text }}>{product.name}</p>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '2px', flexWrap: 'wrap' }}>
                            <span style={{ fontSize: '13px', color: tokens.muted }}>
                              {formatCurrency(unitPrice)} / {product.unit}
                            </span>
                          </div>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                          <button
                            onClick={() => updateCart(product.id, -1)}
                            disabled={qty === 0}
                            style={{ width: '32px', height: '32px', borderRadius: '50%', border: 'none', background: qty > 0 ? tokens.primary : isDark ? 'rgba(255,255,255,0.12)' : '#ddd', color: 'white', fontSize: '18px', fontWeight: 'bold', cursor: qty > 0 ? 'pointer' : 'not-allowed', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                          >
                            −
                          </button>
                          <span style={{ width: '28px', textAlign: 'center', fontWeight: 'bold', fontSize: '16px' }}>{qty}</span>
                          <button
                            onClick={() => updateCart(product.id, 1)}
                            disabled={plusDisabled}
                            style={{ width: '32px', height: '32px', borderRadius: '50%', border: 'none', background: plusDisabled ? isDark ? 'rgba(255,255,255,0.12)' : '#ddd' : tokens.primary, color: 'white', fontSize: '18px', fontWeight: 'bold', cursor: plusDisabled ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                          >
                            +
                          </button>
                        </div>
                      </div>
                      {idx < arr.length - 1 && (
                        <div style={{ height: 1, background: tokens.divider, margin: '0 4px' }} />
                      )}
                      </Fragment>
                    );
                  })}
                </>
              )}
            </div>
          )}
        </div>

        {/* Notes */}
        <div style={{ background: tokens.card, borderRadius: '16px', padding: '20px', boxShadow: '0 4px 20px rgba(0,0,0,0.15)', backdropFilter: tokens.cardBlur, WebkitBackdropFilter: tokens.cardBlur, border: `1px solid ${tokens.primaryBorder}` }}>
          <label style={{ fontSize: '14px', fontWeight: '600', color: tokens.text, display: 'block', marginBottom: '10px' }}>
            📝 {t('placeOrder.notes')}
          </label>
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder={t('placeOrder.notesPlaceholder')}
            rows={3}
            style={{ width: '100%', padding: '12px', fontSize: '14px', border: `2px solid ${tokens.primary}`, borderRadius: '8px', outline: 'none', resize: 'vertical', fontFamily: 'inherit', boxSizing: 'border-box', background: tokens.inputBg, color: tokens.text }}
          />
        </div>

        {/* Refill: empty Vividaqua gallon reminder (stronger when free gift vouchers apply to refill) */}
        {cartItems.length > 0 && hasRefillInCart && (
          <div
            style={{
              background: hasRefillGiftVoucherUse
                ? isDark
                  ? 'rgba(255,193,7,0.14)'
                  : '#fff8e1'
                : isDark
                  ? 'rgba(33,150,243,0.12)'
                  : '#e3f2fd',
              border: `2px solid ${hasRefillGiftVoucherUse ? theme.warning : theme.info}`,
              borderRadius: '16px',
              padding: '16px 18px',
              fontSize: '13px',
              color: tokens.text,
              lineHeight: 1.55,
            }}
          >
            <p style={{ margin: '0 0 8px 0', fontWeight: '700', fontSize: '14px' }}>
              {hasRefillGiftVoucherUse ? '⚠️' : '💧'}{' '}
              {hasRefillGiftVoucherUse
                ? t('placeOrder.refillBarrelNoticeGiftTitle')
                : t('placeOrder.refillBarrelNoticeTitle')}
            </p>
            <p style={{ margin: 0 }}>
              {hasRefillGiftVoucherUse
                ? t('placeOrder.refillBarrelNoticeGiftBody')
                : t('placeOrder.refillBarrelNoticeBody')}
            </p>
          </div>
        )}

        {/* Order Summary */}
        {cartItems.length > 0 && (
          <div style={{ background: tokens.card, borderRadius: '16px', padding: '20px', boxShadow: '0 4px 20px rgba(0,0,0,0.15)', backdropFilter: tokens.cardBlur, WebkitBackdropFilter: tokens.cardBlur, border: `1px solid ${tokens.primaryBorder}` }}>
            <p style={{ fontSize: '14px', fontWeight: '600', color: tokens.text, margin: '0 0 12px 0' }}>📋 {t('placeOrder.orderSummary')}</p>
            {cartItems.map((item, idx) => {
              const vb = voucherBreakdown[idx];
              const pricedQty = vb ? vb.byPaidVoucher + vb.byPayment : item.quantity;
              const lineOrderValue = pricedQty * getUnitPrice(item.product);
              return (
                <div key={item.product.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', color: tokens.muted, marginBottom: '6px' }}>
                  <span>
                    {item.product.name} × {item.quantity}
                    {vb && vb.byGift > 0 ? (
                      <span style={{ fontSize: '11px', opacity: 0.85 }}> ({vb.byGift} {t('placeOrder.giftTicket')})</span>
                    ) : null}
                  </span>
                  <span>{formatCurrency(lineOrderValue)}</span>
                </div>
              );
            })}
            <div style={{ borderTop: '1px solid #eee', marginTop: '10px', paddingTop: '10px', display: 'flex', justifyContent: 'space-between', fontWeight: 'bold', fontSize: '16px' }}>
              <span>{t('common.total')}</span>
              <span style={{ color: tokens.primary }}>{formatCurrency(orderTotalAmount)}</span>
            </div>
          </div>
        )}

        {/* Billing arrangement for postpaid customers */}
        {cartItems.length > 0 && !isPrePay && (
          <div style={{ background: tokens.card, borderRadius: '16px', padding: '20px', boxShadow: '0 4px 20px rgba(0,0,0,0.15)', backdropFilter: tokens.cardBlur, WebkitBackdropFilter: tokens.cardBlur, border: `1px solid ${tokens.primaryBorder}` }}>
            <p style={{ margin: '0 0 12px 0', fontWeight: '700', color: tokens.text, fontSize: '14px' }}>
              📋 {t('placeOrder.billingArrangement')}
            </p>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', color: tokens.muted, marginBottom: '8px' }}>
              <span>{t('account.billingTerm')}</span>
              <strong style={{ color: tokens.primary }}>{paymentTermLabel}</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', color: tokens.muted }}>
              <span>{t('placeOrder.onCredit')}</span>
              <strong style={{ color: tokens.primary }}>{formatCurrency(payableAmount)}</strong>
            </div>
            <p style={{ margin: '10px 0 0', fontSize: '12px', lineHeight: 1.45, color: tokens.muted }}>
              {t('placeOrder.billingArrangementDesc')}
            </p>
            {creditLimit !== null && (
              <p style={{ margin: '6px 0 0', fontSize: '12px', color: unpaidCredit + payableAmount > creditLimit ? theme.error : tokens.muted }}>
                {t('home.creditLimit')}: {formatCurrency(Math.max(0, creditLimit - unpaidCredit))} {t('placeOrder.remaining')}
              </p>
            )}
          </div>
        )}

        {/* Payment breakdown for pre-pay orders with a remaining QRIS amount. */}
        {cartItems.length > 0 && isPrePay && payableAmount > 0 && (
          <div style={{ background: tokens.card, borderRadius: '16px', padding: '20px', boxShadow: '0 4px 20px rgba(0,0,0,0.15)', backdropFilter: tokens.cardBlur, WebkitBackdropFilter: tokens.cardBlur, border: `1px solid ${tokens.primaryBorder}` }}>
            <p style={{ margin: '0 0 12px 0', fontWeight: '700', color: tokens.text, fontSize: '14px' }}>💳 {t('placeOrder.paymentBreakdown')}</p>
            {voucherBreakdown.filter(({ byPayment }) => byPayment > 0).map(({ item, byVoucher, byPayment }) => {
              const available = productVouchers.get(item.product.id) ?? 0;
              return (
                <div key={item.product.id} style={{ marginBottom: '10px', padding: '10px 12px', background: tokens.primaryBg, borderRadius: '10px', border: `1px solid ${tokens.primaryBorder}` }}>
                  <p style={{ margin: '0 0 6px 0', fontWeight: '600', fontSize: '13px', color: tokens.text }}>{item.product.name} × {item.quantity}</p>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: tokens.muted, marginBottom: '3px' }}>
                    <span>🎫 {t('placeOrder.currentVouchers')}: <strong style={{ color: tokens.primary }}>{available}</strong></span>
                    {byVoucher > 0 && <span style={{ color: tokens.primary }}>{t('placeOrder.coveredBy')} {byVoucher}</span>}
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: tokens.muted }}>
                    <span>{t('placeOrder.atFullPrice')}: <strong>{byPayment}</strong></span>
                    <span style={{ fontWeight: '600', color: tokens.text }}>{formatCurrency(byPayment * getUnitPrice(item.product))}</span>
                  </div>
                </div>
              );
            })}
            <div style={{ borderTop: `1px solid ${tokens.divider}`, marginTop: '4px', paddingTop: '12px', display: 'flex', justifyContent: 'space-between', fontWeight: '700', fontSize: '15px', color: tokens.text }}>
              <span>{t('placeOrder.payViaQris')}</span>
              <span style={{ color: tokens.primary }}>{formatCurrency(payableAmount)}</span>
            </div>
            {payableAmount < grossCartTotal && (
              <p style={{ margin: '6px 0 0', fontSize: '12px', color: tokens.muted }}>
                {formatCurrency(grossCartTotal - payableAmount)} {t('placeOrder.voucherCovered')}
              </p>
            )}
          </div>
        )}

        {/* Unpaid orders block */}
        {error === 'UNPAID_ORDERS' && (
          <div style={{ background: '#fdecea', border: `2px solid ${theme.error}`, borderRadius: '12px', padding: '16px' }}>
            <p style={{ margin: '0 0 8px 0', fontWeight: '700', color: theme.error, fontSize: '14px' }}>
              🚫 {t('placeOrder.unpaidBills')}
            </p>
            <p style={{ margin: '0 0 12px 0', fontSize: '13px', color: theme.error }}>
              {t('placeOrder.unpaidBillsDesc')}
            </p>
            <button
              onClick={() => navigate('/orders')}
              style={{ padding: '10px 20px', background: tokens.gradientPrimary, color: 'white', border: 'none', borderRadius: '8px', fontSize: '14px', fontWeight: 'bold', cursor: 'pointer' }}
            >
              💳 {t('placeOrder.viewPayBills')}
            </button>
          </div>
        )}

        {/* Credit limit exceeded */}
        {error === 'PRE_PAY_REQUIRES_PAYMENT' && (
          <div style={{ background: '#fdecea', border: `2px solid ${theme.error}`, borderRadius: '12px', padding: '16px' }}>
            <p style={{ margin: '0 0 6px 0', fontWeight: '700', color: theme.error, fontSize: '14px' }}>
              {t('placeOrder.prePayRequiresPaymentTitle')}
            </p>
            <p style={{ margin: 0, fontSize: '13px', color: theme.error }}>{t('placeOrder.prePayRequiresPaymentDesc')}</p>
          </div>
        )}

        {error === 'CREDIT_LIMIT_EXCEEDED' && (
          <div style={{ background: '#fdecea', border: `2px solid ${theme.error}`, borderRadius: '12px', padding: '16px' }}>
            <p style={{ margin: '0 0 6px 0', fontWeight: '700', color: theme.error, fontSize: '14px' }}>
              🚫 {t('placeOrder.creditLimitExceeded')}
            </p>
            <p style={{ margin: 0, fontSize: '13px', color: theme.error }}>
              {t('placeOrder.creditLimitDesc')}{creditLimit !== null ? ` (${formatCurrency(Math.max(0, creditLimit - unpaidCredit))} ${t('placeOrder.remaining')})` : ''}
            </p>
          </div>
        )}

        {error === 'DELIVERY_DATE_TOO_SOON' && (
          <div style={{ background: '#fdecea', border: `2px solid ${theme.error}`, borderRadius: '12px', padding: '16px' }}>
            <p style={{ margin: 0, fontWeight: '700', color: theme.error, fontSize: '14px' }}>🚫 {t('placeOrder.deliveryDateTooSoonTitle')}</p>
            <p style={{ margin: '8px 0 0', fontSize: '13px', color: theme.error }}>{t('placeOrder.deliveryDateTooSoonDesc')}</p>
          </div>
        )}

        {error === 'DELIVERY_DATE_BRANCH_CLOSED' && (
          <div style={{ background: '#fdecea', border: `2px solid ${theme.error}`, borderRadius: '12px', padding: '16px' }}>
            <p style={{ margin: 0, fontWeight: '700', color: theme.error, fontSize: '14px' }}>🚫 {t('placeOrder.deliveryDateClosedTitle')}</p>
            <p style={{ margin: '8px 0 0', fontSize: '13px', color: theme.error }}>{t('placeOrder.deliveryDateClosedDesc')}</p>
          </div>
        )}

        {error === 'ORDER_NOT_EDITABLE' && (
          <div style={{ background: '#fdecea', border: `2px solid ${theme.error}`, borderRadius: '12px', padding: '16px' }}>
            <p style={{ margin: 0, fontWeight: '700', color: theme.error, fontSize: '14px' }}>{t('placeOrder.orderNotEditableTitle')}</p>
            <p style={{ margin: '8px 0 0', fontSize: '13px', color: theme.error }}>{t('placeOrder.orderNotEditableDesc')}</p>
          </div>
        )}

        {error === 'VOUCHER_ORDER_EDIT_NOT_SUPPORTED' && (
          <div style={{ background: '#fdecea', border: `2px solid ${theme.error}`, borderRadius: '12px', padding: '16px' }}>
            <p style={{ margin: 0, fontWeight: '700', color: theme.error, fontSize: '14px' }}>{t('placeOrder.voucherOrderEditTitle')}</p>
            <p style={{ margin: '8px 0 0', fontSize: '13px', color: theme.error }}>{t('placeOrder.voucherOrderEditDesc')}</p>
          </div>
        )}

        {/* Error */}
        {error && error !== 'UNPAID_ORDERS' && error !== 'PRE_PAY_REQUIRES_PAYMENT' && error !== 'CREDIT_LIMIT_EXCEEDED' && error !== 'DELIVERY_DATE_TOO_SOON' && error !== 'DELIVERY_DATE_BRANCH_CLOSED' && error !== 'ORDER_NOT_EDITABLE' && error !== 'VOUCHER_ORDER_EDIT_NOT_SUPPORTED' && (
          <div style={{ background: '#fdecea', border: `2px solid ${theme.error}`, borderRadius: '12px', padding: '14px 16px', color: theme.error, fontSize: '14px' }}>
            ⚠️ {error}
          </div>
        )}

        {/* Submit */}
        <button
          onClick={() => {
            if (blockedByUnpaid) { setShowUnpaidModal(true); return; }
            if (isPrePay && !hasEnoughVouchers) {
              try {
                if (localStorage.getItem(`vividaqua:voucher-only-order:${customer.id}`)) {
                  handleSubmit();
                  return;
                }
              } catch {
                handleSubmit();
                return;
              }
              handlePayWithQris();
              return;
            }
            handleSubmit();
          }}
          disabled={submitting || cartItems.length === 0}
          style={{
            width: '100%', padding: '16px',
            background: (submitting || cartItems.length === 0) ? (isDark ? 'rgba(255,255,255,0.1)' : '#ccc') : tokens.gradientPrimary,
            color: 'white', border: 'none', borderRadius: '12px', fontSize: '16px', fontWeight: 'bold',
            cursor: (submitting || cartItems.length === 0) ? 'not-allowed' : 'pointer',
          }}
        >
          {submitting
            ? t('placeOrder.processing')
            : editOrderId
              ? `✅ ${t('placeOrder.update')}`
              : isPrePay && !hasEnoughVouchers && cartItems.length > 0
                ? `💳 ${t('placeOrder.submit')} · ${t('placeOrder.payViaQris')} ${formatCurrency(payableAmount)}`
                : !isPrePay
                  ? `✅ ${t('placeOrder.submit')} · ${paymentTermLabel}`
                  : `✅ ${t('placeOrder.submit')}`}
        </button>
      </div>

      <BottomNavV0 customer={customer} />

      {/* Unpaid Orders Modal */}
      {showUnpaidModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 3000, padding: '20px' }}>
          <div style={{ background: 'white', borderRadius: '20px', padding: '28px 24px', maxWidth: '360px', width: '100%', textAlign: 'center', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}>
            <p style={{ fontSize: '48px', margin: '0 0 12px 0' }}>⚠️</p>
            <h3 style={{ fontSize: '18px', fontWeight: '700', color: theme.error, margin: '0 0 12px 0' }}>{t('placeOrder.outstandingBalance')}</h3>
            <p style={{ fontSize: '14px', color: '#555', margin: '0 0 24px 0', lineHeight: '1.5' }}>
              {t('placeOrder.outstandingDesc')}
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <button
                onClick={() => { setShowUnpaidModal(false); navigate('/orders'); }}
                style={{ width: '100%', padding: '13px', background: tokens.gradientPrimary, color: 'white', border: 'none', borderRadius: '10px', fontSize: '15px', fontWeight: 'bold', cursor: 'pointer' }}
              >
                💳 {t('placeOrder.viewPayBills')}
              </button>
              <button
                onClick={() => setShowUnpaidModal(false)}
                style={{ width: '100%', padding: '11px', background: 'none', color: tokens.muted, border: `2px solid #ddd`, borderRadius: '10px', fontSize: '14px', cursor: 'pointer' }}
              >
                {t('common.close')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
