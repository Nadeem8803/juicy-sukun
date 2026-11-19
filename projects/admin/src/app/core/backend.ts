import { InjectionToken } from '@angular/core';
import type { AppConfig, CustomerRecord, DailyStats, Expense, MenuItem, Offer, Order, OrderStatus, PayMethod, ShopStatus, PublicReview } from '@juicy/shared';

export interface AdminUser {
  email: string;
}

/** Everything the owner app needs from the server. Firebase in production, in-memory for `?demo` in dev builds. */
export interface AdminBackend {
  /** Calls back with the signed-in owner, or null. Non-owner accounts are signed out and reported as null. */
  onAuth(cb: (user: AdminUser | null) => void): () => void;
  signIn(email: string, password: string): Promise<void>;
  signOut(): Promise<void>;
  /** `fromServer` is false for cached snapshots: never treat an empty cached list as "no orders". */
  watchOrders(cb: (orders: Order[], fromServer: boolean) => void, onError?: (e: unknown) => void): () => void;
  changeStatus(orderId: string, status: OrderStatus, reason?: string, readyInMin?: number): Promise<void>;
  /** Owner confirms the money was received (for a dine-in order this pays the whole table bill). */
  markPaid(orderId: string, method: PayMethod, via?: 'sms'): Promise<void>;
  /** Owner: the customer's "I have paid" was wrong or not received. */
  dismissClaim(orderId: string): Promise<void>;
  /** Orders created at or after `since` (for the ledger and analytics). */
  loadOrdersSince(since: number): Promise<Order[]>;
  watchExpenses(cb: (items: Expense[]) => void): () => void;
  saveExpense(e: Expense): Promise<void>;
  deleteExpense(id: string): Promise<void>;
  /** Per-day visit counters, newest first. */
  loadDaily(days: number): Promise<DailyStats[]>;
  loadCustomers(): Promise<CustomerRecord[]>;
  watchOffers(cb: (items: Offer[]) => void): () => void;
  saveOffer(o: Offer): Promise<void>;
  watchReviews(cb: (items: PublicReview[]) => void): () => void;
  /** Show / hide one review on the customer menu. */
  setReviewPublic(order: Order, on: boolean): Promise<void>;
  deleteOffer(id: string): Promise<void>;
  /** Quick sold-out switch. */
  setAvailable(itemId: string, available: boolean): Promise<void>;
  watchMenu(cb: (items: MenuItem[]) => void): () => void;
  saveItem(item: MenuItem): Promise<void>;
  deleteItem(id: string): Promise<void>;
  uploadImage(itemId: string, image: Blob): Promise<string>;
  watchShop(cb: (s: ShopStatus) => void): () => void;
  setShop(open: boolean, message?: string): Promise<void>;
  loadConfig(): Promise<AppConfig>;
  saveConfig(c: AppConfig): Promise<void>;
  registerToken(token: string): Promise<void>;
}

export const BACKEND = new InjectionToken<AdminBackend>('AdminBackend');
