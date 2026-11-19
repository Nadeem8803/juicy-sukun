import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';

/** `--name=value` and `--flag` arguments, plus positional ones. */
export function parseArgs(argv: string[]): { flags: Record<string, string | true>; positional: string[] } {
  const flags: Record<string, string | true> = {};
  const positional: string[] = [];
  for (const arg of argv) {
    if (arg.startsWith('--')) {
      const [k, ...rest] = arg.slice(2).split('=');
      flags[k] = rest.length ? rest.join('=') : true;
    } else {
      positional.push(arg);
    }
  }
  return { flags, positional };
}

/**
 * Against the emulators: set FIRESTORE_EMULATOR_HOST / FIREBASE_AUTH_EMULATOR_HOST (emulators:exec does this).
 * Against production: set GOOGLE_APPLICATION_CREDENTIALS to a service-account key file (see README).
 */
export function initAdmin(): void {
  if (getApps().length) return;
  const projectId = process.env['GCLOUD_PROJECT'] ?? process.env['FIREBASE_PROJECT'];
  const usingEmulator = !!process.env['FIRESTORE_EMULATOR_HOST'];
  if (!usingEmulator && !process.env['GOOGLE_APPLICATION_CREDENTIALS']) {
    console.error(
      'GOOGLE_APPLICATION_CREDENTIALS is not set.\n' +
        'Download a service-account key (Firebase console > Project settings > Service accounts) and run:\n' +
        '  export GOOGLE_APPLICATION_CREDENTIALS=/full/path/to/key.json',
    );
    process.exit(1);
  }
  initializeApp({ credential: usingEmulator ? undefined : applicationDefault(), projectId });
}
