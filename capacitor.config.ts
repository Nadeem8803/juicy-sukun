import type { CapacitorConfig } from '@capacitor/cli';

/** The owner app: the Angular "admin" build wrapped in a native Android shell. */
const config: CapacitorConfig = {
  appId: 'com.juicysukun.admin',
  appName: 'Juicysukun Owner',
  webDir: 'dist/admin/browser',
  android: { allowMixedContent: false },
};

export default config;
