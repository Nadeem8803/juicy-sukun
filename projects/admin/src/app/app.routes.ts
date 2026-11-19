import { inject } from '@angular/core';
import { CanActivateFn, Router, Routes } from '@angular/router';
import { toObservable } from '@angular/core/rxjs-interop';
import { filter, map, take } from 'rxjs';
import { Session } from './core/session';

/** Waits for Firebase to say who is signed in, then sends signed-out visitors to the login page. */
export const signedInGuard: CanActivateFn = () => {
  const session = inject(Session);
  const router = inject(Router);
  return toObservable(session.ready).pipe(
    filter(Boolean),
    take(1),
    map(() => (session.signedIn() ? true : router.createUrlTree(['/login']))),
  );
};

export const routes: Routes = [
  { path: 'login', title: 'Sign in', loadComponent: () => import('./pages/login-page').then((m) => m.LoginPage) },
  {
    path: '',
    canActivate: [signedInGuard],
    loadComponent: () => import('./pages/shell').then((m) => m.Shell),
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'orders' },
      { path: 'orders', title: 'Orders', loadComponent: () => import('./pages/orders-page').then((m) => m.OrdersPage) },
      { path: 'menu', title: 'Menu', loadComponent: () => import('./pages/menu-page').then((m) => m.MenuPage) },
      { path: 'books', title: 'Books', loadComponent: () => import('./pages/books-page').then((m) => m.BooksPage) },
      { path: 'settings', title: 'Settings', loadComponent: () => import('./pages/settings-page').then((m) => m.SettingsPage) },
    ],
  },
  { path: '**', redirectTo: '' },
];
