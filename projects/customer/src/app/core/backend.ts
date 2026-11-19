import { InjectionToken } from '@angular/core';
import type { MenuItem, Offer, Order, PlaceOrderRequest, PlaceOrderResult, PublicConfig, ShopStatus, PublicReview } from '@juicy/shared';

/** Everything the customer app needs from "the server". Firebase in production, in-memory for `?demo` in dev builds. */
export interface CustomerBackend {
  watchMenu(cb: (items: MenuItem[]) => void): () => void;
  watchShop(cb: (shop: ShopStatus) => void): () => void;
  watchConfig(cb: (cfg: PublicConfig) => void): () => void;
  placeOrder(req: PlaceOrderRequest): Promise<PlaceOrderResult>;
  /** Calls back with null if the order does not exist / is not yours. */
  watchOrder(id: string, cb: (order: Order | null) => void): () => void;
  cancelOrder(id: string): Promise<void>;
  /** "I have paid by UPI": tells the owner to check. */
  claimPayment(orderId: string): Promise<void>;
  submitReview(orderId: string, rating: number, comment: string): Promise<void>;
  /** Discount (percent) this phone would get now. 0 if none / unknown. */
  loyaltyPercent(phone: string): Promise<{ percent: number; orders: number }>;
  watchOffers(cb: (offers: Offer[]) => void): () => void;
  watchReviews(cb: (reviews: PublicReview[]) => void): () => void;
  /** Anonymous activity ping (never throws). */
  track(body: unknown): void;
  /** Asks for notification permission (call from a tap) and saves this phone's push address. Optional: demo backend skips it. */
  enablePush?(): Promise<boolean>;
}

export const BACKEND = new InjectionToken<CustomerBackend>('CustomerBackend');
