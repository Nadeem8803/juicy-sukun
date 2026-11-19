import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', title: 'Juicysukun Café – Order online', loadComponent: () => import('./pages/menu-page').then((m) => m.MenuPage) },
  { path: 'cart', title: 'Your cart', loadComponent: () => import('./pages/cart-page').then((m) => m.CartPage) },
  { path: 'orders', title: 'My orders', loadComponent: () => import('./pages/orders-page').then((m) => m.OrdersPage) },
  { path: 'order/:id', title: 'Your order', loadComponent: () => import('./pages/order-page').then((m) => m.OrderPage) },
  { path: 'privacy', title: 'Privacy', loadComponent: () => import('./pages/privacy-page').then((m) => m.PrivacyPage) },
  { path: '**', redirectTo: '' },
];
