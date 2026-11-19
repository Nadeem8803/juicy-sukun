import { ChangeDetectionStrategy, Component, DestroyRef, effect, inject, signal } from '@angular/core';
import { Router, RouterOutlet } from '@angular/router';
import { App as CapApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { closeTopOverlay } from './core/back-close';
import { Session } from './core/session';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (!session.ready()) {
      <div class="splash" aria-busy="true"><span class="brand">Juicy<span>sukun</span></span><small>Loading…</small></div>
    } @else {
      <router-outlet />
    }

    @if (leaving()) {
      <div class="overlay" (click)="leaving.set(false)" role="presentation">
        <div class="dialog" role="alertdialog" aria-modal="true" aria-labelledby="lv-title" (click)="$event.stopPropagation()" data-testid="leave-dialog">
          <h2 id="lv-title">Leave the app?</h2>
          <p>You will not hear the new-order alarm if you close the app completely. Keep it open in the background to be safe.</p>
          <div class="actions">
            <button type="button" class="btn" (click)="leaving.set(false)">Stay</button>
            <button type="button" class="btn danger solid" (click)="leave()" data-testid="leave-confirm">Go to home screen</button>
          </div>
        </div>
      </div>
    }
  `,
})
export class App {
  protected readonly session = inject(Session);
  protected readonly leaving = signal(false);
  private readonly router = inject(Router);

  constructor() {
    // Signing out (or being signed out) anywhere sends you to the login page.
    effect(() => {
      if (this.session.ready() && !this.session.signedIn() && !this.router.url.startsWith('/login')) void this.router.navigate(['/login']);
    });

    if (Capacitor.isNativePlatform()) {
      const handle = CapApp.addListener('backButton', () => {
        if (this.leaving()) return this.leaving.set(false);
        if (closeTopOverlay()) return; // a popup was open: close just that
        const url = this.router.url;
        if (url.startsWith('/menu') || url.startsWith('/settings')) void this.router.navigate(['/orders']);
        else this.leaving.set(true); // on the main screen: always ask first
      });
      inject(DestroyRef).onDestroy(() => void handle.then((h) => h.remove()));
    }
  }

  protected leave(): void {
    this.leaving.set(false);
    void CapApp.minimizeApp();
  }
}
