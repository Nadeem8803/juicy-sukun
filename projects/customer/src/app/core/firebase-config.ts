/**
 * Paste your web-app config here (Firebase console > Project settings > Your apps > Web app > Config).
 * These values are NOT secrets; security comes from firestore.rules and the Cloud Functions.
 */
export const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyA4dZiRKtTipxSA6Fbc1rJHcpsVyZj1fPs',
  authDomain: 'juicy-sukun.firebaseapp.com',
  projectId: 'juicy-sukun',
  storageBucket: 'juicy-sukun.firebasestorage.app',
  messagingSenderId: '129925390040',
  appId: '1:129925390040:web:b6d762b46f2ea0369d81ad',
};

export const FUNCTIONS_REGION = 'asia-south1';

/** On localhost the app talks to the Firebase emulators (`npm run emulators`), never to production data. */
export function useEmulators(): boolean {
  return typeof location !== 'undefined' && ['localhost', '127.0.0.1'].includes(location.hostname);
}

/** In emulator mode the project id must start with `demo-` so nothing can ever reach a real project. */
export const EMULATOR_CONFIG = { apiKey: 'demo', projectId: 'demo-juicysukun', appId: 'demo', authDomain: 'localhost' };
