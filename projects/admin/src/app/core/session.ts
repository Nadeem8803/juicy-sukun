import { Injectable, computed, inject, signal } from '@angular/core';
import { BACKEND, type AdminUser } from './backend';

@Injectable({ providedIn: 'root' })
export class Session {
  private readonly backend = inject(BACKEND);
  readonly user = signal<AdminUser | null>(null);
  /** False until Firebase tells us whether someone is signed in (avoids flashing the login page). */
  readonly ready = signal(false);
  readonly signedIn = computed(() => this.user() !== null);

  constructor() {
    this.backend.onAuth((u) => {
      this.user.set(u);
      this.ready.set(true);
    });
  }

  signIn(email: string, password: string): Promise<void> {
    return this.backend.signIn(email, password);
  }
  signOut(): Promise<void> {
    return this.backend.signOut();
  }
}
