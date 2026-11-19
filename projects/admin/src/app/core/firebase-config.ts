/** Same values as the customer app (Firebase console > Project settings > Your apps > Web app). Not secret. */
export const FIREBASE_CONFIG = {
    apiKey: 'AIzaSyA4dZiRKtTipxSA6Fbc1rJHcpsVyZj1fPs',
  authDomain: 'juicy-sukun.firebaseapp.com',
  projectId: 'juicy-sukun',
  storageBucket: 'juicy-sukun.firebasestorage.app',
  messagingSenderId: '129925390040',
  appId: '1:129925390040:web:b6d762b46f2ea0369d81ad',
};

export const FUNCTIONS_REGION = 'asia-south1';

/** In a browser on localhost the app uses the emulators. The Android app (capacitor://… / https://localhost) uses production. */
export function useEmulators(): boolean {
  const cap = (globalThis as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  if (cap?.isNativePlatform?.()) return false;
  return typeof location !== 'undefined' && ['localhost', '127.0.0.1'].includes(location.hostname);
}

export const EMULATOR_CONFIG = {
  apiKey: 'demo',
  projectId: 'demo-juicysukun',
  appId: 'demo',
  authDomain: 'localhost',
  storageBucket: 'demo-juicysukun.appspot.com',
};
