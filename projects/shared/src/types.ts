/**
 * Domain types shared by the customer PWA, the admin app and Cloud Functions.
 * All timestamps are epoch milliseconds (numbers) so this file has no Firebase dependency.
 */

export const CATEGORIES = [
  'Pizza',
  'Burgers',
  'Fries',
  'Garlic Bread',
  'Pasta',
  'JS Starters',
  'Cold Drinks',
  'Drinks',
  'Extras',
] as const;

export type Category = (typeof CATEGORIES)[number];

/** One orderable size. Single-size items use an empty label. */
export interface SizeOption {
  label: string;
  price: number;
}

/** Limits for the choices an owner can add to one food item. */
export const MAX_SIZES = 4;
export const MAX_ADDONS = 8;
export const MAX_OPTIONS = 8;
export const MAX_LINE_NOTE = 80;

export interface MenuItem {
  id: string;
  name: string;
  category: string;
  sizes: SizeOption[];
  /** Optional extras the customer can tick; each can add to the price (label + extra price, may be 0). */
  addons?: SizeOption[];
  /** Optional no-price choices (e.g. "Less sugar", "No ice"). */
  options?: string[];
  /** When true the customer may type a short note for this item. */
  allowNote?: boolean;
  /** true = veg, false = non-veg, missing = not marked. */
  veg?: boolean;
  available: boolean;
  special?: boolean;
  imageUrl?: string | null;
  sort: number;
}

export type OrderStatus =
  | 'pending'
  | 'accepted'
  | 'preparing'
  | 'out_for_delivery'
  | 'delivered'
  | 'rejected'
  | 'cancelled'
  | 'expired';

export type OrderType = 'delivery' | 'dine_in';
export type PayMethod = 'cash' | 'upi' | 'card';
export const PAY_METHOD_LABEL: Record<PayMethod, string> = { cash: 'Cash', upi: 'UPI', card: 'Card' };

/** Readable by everyone (customers need it to show the delivery rule). */
export interface PublicConfig {
  cafeName: string;
  freeDeliveryMin: number;
  deliveryFee: number;
  maxLines: number;
  maxQtyPerLine: number;
  /** How many tables the customer can pick from when dining in (1..tableCount). */
  tableCount: number;
  /** Customers can pay by UPI from their phone (QR + app button). */
  upiEnabled: boolean;
  upiId: string;
  /** Name shown in the customer's UPI app. */
  upiName: string;
  /** Loyalty: after `loyaltyAfter` completed orders, every next order gets `loyaltyPercent` % off. */
  loyaltyEnabled: boolean;
  loyaltyAfter: number;
  loyaltyPercent: number;
  /** Add 1-99 paise (from the order number) to the UPI amount, so two same-priced orders can be told apart. Off by default. */
  upiPaise: boolean;
  /** Busy mode: customers see a "we're busy" notice and the ready time grows by `busyExtraMin`. */
  busyMode: boolean;
  busyExtraMin: number;
  /** Delivery only within this many km of the cafe (0 = no limit). Needs the cafe position below. */
  deliveryMaxKm: number;
  cafeLat: number;
  cafeLng: number;
}

/** Admin-only. Copied onto an order only once the owner accepts it. */
export interface PrivateConfig {
  cafePhone: string;
  cafeAddress: string;
  fssai: string;
  orderTimeoutMinutes: number;
}

export type AppConfig = PublicConfig & PrivateConfig;

export interface ShopStatus {
  open: boolean;
  message?: string;
  updatedAt?: number;
}

export interface CartLine {
  itemId: string;
  sizeIndex: number;
  qty: number;
  /** Indexes into the item's `addons`. */
  addons?: number[];
  /** Indexes into the item's `options`. */
  options?: number[];
  note?: string;
}

export interface OrderLine {
  itemId: string;
  name: string;
  sizeLabel: string;
  unitPrice: number;
  qty: number;
  total: number;
  /** Chosen add-ons (already included in unitPrice). */
  addons?: SizeOption[];
  options?: string[];
  note?: string;
}

export interface CustomerInfo {
  name: string;
  phone: string;
  address: string;
  landmark?: string;
}

export interface GeoPoint {
  lat: number;
  lng: number;
  accuracy?: number;
}

export interface PlaceOrderRequest {
  lines: CartLine[];
  customer: CustomerInfo;
  location?: GeoPoint | null;
  note?: string;
  /** Defaults to 'delivery'. Dine-in needs `table`; address and delivery fee do not apply. */
  orderType?: OrderType;
  table?: string;
  /** The customer agreed to receive offers on WhatsApp. */
  offersOptIn?: boolean;
}

export interface InvoiceInfo {
  cafeName: string;
  cafePhone: string;
  cafeAddress: string;
  fssai: string;
}

export interface OrderHistoryEntry {
  status: OrderStatus;
  at: number;
  reason?: string;
}

export interface Order {
  id: string;
  number: string;
  customerUid: string;
  customer: CustomerInfo;
  location: GeoPoint | null;
  note: string;
  lines: OrderLine[];
  subtotal: number;
  deliveryFee: number;
  total: number;
  status: OrderStatus;
  paymentMethod: 'COD';
  createdAt: number;
  expiresAt: number;
  history: OrderHistoryEntry[];
  /** Set when the owner accepts. Only then does the customer see the cafe number. */
  invoice?: InvoiceInfo;
  rejectReason?: string;
  closedAt?: number;
  /** Missing on older orders = 'delivery'. */
  orderType?: OrderType;
  /** Dine-in only: the table label, e.g. "4". */
  table?: string;
  /** Dine-in only: orders of one table that are paid together share a billId. */
  billId?: string;
  /** Dine-in only: 'open' until the owner confirms payment (or the order is rejected / cancelled). */
  billState?: 'open' | 'paid' | 'closed';
  /** Set when the owner confirms the money was received. */
  payment?: { method: PayMethod; at: number; /** 'sms' when the owner confirmed it from a matching bank SMS. */ via?: 'sms' };
  /** The customer says they paid by UPI; the owner still has to check and confirm. */
  payClaim?: { method: PayMethod; at: number } | null;
  /** Loyalty discount already taken off `total`. */
  discount?: { percent: number; amount: number };
  /** When the owner expects the food to be ready (epoch ms). Set when the order is accepted. */
  readyAt?: number;
  /** Customer feedback, given once after the order is delivered. */
  review?: { rating: number; comment?: string; at: number };
}

/** One regular customer, kept by phone number (owner only). */
export interface CustomerRecord {
  phone: string;
  name: string;
  /** Completed (delivered / served) orders. */
  orders: number;
  placed: number;
  spent: number;
  firstAt: number;
  lastAt: number;
  /** Agreed to get offers on WhatsApp. */
  optIn: boolean;
}

/** Banner shown to customers (owner's own promo or a local sponsor). */
/** A review shown on the customer menu (first name only, never a phone number). */
export interface PublicReview {
  id: string;
  name: string;
  rating: number;
  comment?: string;
  at: number;
  public: boolean;
}

export interface Offer {
  id: string;
  title: string;
  text?: string;
  imageUrl?: string | null;
  link?: string;
  sponsored?: boolean;
  /** Epoch ms; the banner shows from `start` to `end`. */
  start: number;
  end: number;
  active: boolean;
  sort: number;
}

export interface Expense {
  id: string;
  /** Local day, YYYY-MM-DD. */
  day: string;
  category: string;
  amount: number;
  note?: string;
  at: number;
}
export const EXPENSE_CATEGORIES = ['Stock / ingredients', 'Rent', 'Salary', 'Electricity / gas', 'Other'] as const;

/** Counters kept per day for the "how many people use the app" screens. `h09` = visits that started 9:00-9:59. */
export interface DailyStats {
  day: string;
  sessions: number;
  visitors: number;
  newVisitors: number;
  returning: number;
  qr: number;
  cart: number;
  checkout: number;
  ordered: number;
  [hour: string]: number | string;
}

export interface PlaceOrderResult {
  orderId: string;
  number: string;
}

export const DEFAULT_PUBLIC_CONFIG: PublicConfig = {
  cafeName: 'Juicysukun Café',
  freeDeliveryMin: 300,
  deliveryFee: 39,
  maxLines: 30,
  maxQtyPerLine: 20,
  tableCount: 10,
  upiEnabled: false,
  upiId: '',
  upiName: 'Juicysukun Cafe',
  loyaltyEnabled: false,
  loyaltyAfter: 5,
  loyaltyPercent: 5,
  upiPaise: false,
  busyMode: false,
  busyExtraMin: 10,
  deliveryMaxKm: 0,
  cafeLat: 0,
  cafeLng: 0,
};

export const DEFAULT_PRIVATE_CONFIG: PrivateConfig = {
  cafePhone: '',
  cafeAddress: 'Akkalkot',
  fssai: '',
  orderTimeoutMinutes: 5,
};

export const DEFAULT_CONFIG: AppConfig = { ...DEFAULT_PUBLIC_CONFIG, ...DEFAULT_PRIVATE_CONFIG };
