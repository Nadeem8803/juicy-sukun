import { isDevMode } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';
import { BACKEND, type AdminBackend } from './app/core/backend';

async function pickBackend(): Promise<AdminBackend> {
  // The in-memory demo exists only in development builds (`ng serve` + `?demo`); the APK always uses Firebase.
  if (isDevMode() && new URLSearchParams(location.search).has('demo')) {
    const { MemoryAdminBackend } = await import('./app/core/memory-backend');
    return new MemoryAdminBackend();
  }
  const { FirebaseAdminBackend } = await import('./app/core/firebase-backend');
  return new FirebaseAdminBackend();
}

pickBackend()
  .then((backend) =>
    bootstrapApplication(App, { ...appConfig, providers: [...appConfig.providers, { provide: BACKEND, useValue: backend }] }),
  )
  .catch((err) => console.error(err));
