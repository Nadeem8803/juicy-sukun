import { DomainError } from './errors';
import type { GeoPoint, PublicConfig } from './types';

/** Straight-line distance between two map points, in km (haversine). */
export function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export type DeliveryArea = { limited: false } | { limited: true; maxKm: number; km: number | null; ok: boolean };

/**
 * Is a delivery to `location` inside the owner's limit? Not limited when the owner left the limit at 0 or has not set the
 * cafe's position. The phone's GPS error (up to 300 m) is given as benefit of the doubt.
 */
export function deliveryArea(config: Pick<PublicConfig, 'deliveryMaxKm' | 'cafeLat' | 'cafeLng'>, location: GeoPoint | null | undefined): DeliveryArea {
  const maxKm = Number(config.deliveryMaxKm) || 0;
  if (maxKm <= 0 || !config.cafeLat || !config.cafeLng) return { limited: false };
  if (!location) return { limited: true, maxKm, km: null, ok: false };
  const raw = distanceKm({ lat: config.cafeLat, lng: config.cafeLng }, location);
  const km = Math.max(0, raw - Math.min(location.accuracy ?? 0, 300) / 1000);
  return { limited: true, maxKm, km: Math.round(km * 10) / 10, ok: km <= maxKm };
}

/** Server rule: throws when a delivery order is outside the limit (or gives no location while a limit is set). */
export function assertWithinDeliveryArea(config: Pick<PublicConfig, 'deliveryMaxKm' | 'cafeLat' | 'cafeLng'>, location: GeoPoint | null | undefined): void {
  const a = deliveryArea(config, location);
  if (!a.limited || a.ok) return;
  if (a.km === null) throw new DomainError('too_far', `We deliver within ${a.maxKm} km. Please share your location so we can check.`);
  throw new DomainError('too_far', `Sorry, we deliver only within ${a.maxKm} km. You are about ${a.km} km away.`);
}
