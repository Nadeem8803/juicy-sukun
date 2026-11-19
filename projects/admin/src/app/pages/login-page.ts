import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { AlarmService } from '../core/alarm';
import { Session } from '../core/session';

export function loginMessage(e: unknown): string {
  const code = (e as { code?: string; message?: string })?.code ?? '';
  if ((e as Error)?.message === 'not_admin') return 'This account is not the cafe owner account.';
  if (code.includes('invalid-credential') || code.includes('wrong-password') || code.includes('user-not-found')) return 'Wrong email or password.';
  if (code.includes('too-many-requests')) return 'Too many tries. Wait a few minutes and try again.';
  if (code.includes('network')) return 'No internet connection.';
  return 'Could not sign in. Please try again.';
}

@Component({
  selector: 'app-login',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="login">
      <h1 class="brand">Juicy<span>sukun</span></h1>
      <p class="sub">Owner app</p>
      <form (submit)="$event.preventDefault(); submit()">
        <label>Email
          <input type="email" autocomplete="username" inputmode="email" [value]="email()" (input)="email.set($any($event.target).value)" data-testid="email" required />
        </label>
        <label>Password
          <input type="password" autocomplete="current-password" [value]="password()" (input)="password.set($any($event.target).value)" data-testid="password" required />
        </label>
        @if (error()) { <p class="err" role="alert" data-testid="login-error">{{ error() }}</p> }
        <button class="btn primary big" type="submit" [disabled]="busy()" data-testid="sign-in">{{ busy() ? 'Signing in…' : 'Sign in' }}</button>
      </form>
    </main>
  `,
})
export class LoginPage {
  private readonly session = inject(Session);
  private readonly router = inject(Router);
  private readonly alarm = inject(AlarmService);
  protected readonly email = signal('');
  protected readonly password = signal('');
  protected readonly busy = signal(false);
  protected readonly error = signal('');

  protected async submit(): Promise<void> {
    this.alarm.unlock(); // this tap lets the browser play the order siren later
    this.error.set('');
    this.busy.set(true);
    try {
      await this.session.signIn(this.email(), this.password());
      await this.router.navigate(['/orders']);
    } catch (e) {
      this.error.set(loginMessage(e));
    } finally {
      this.busy.set(false);
    }
  }
}
