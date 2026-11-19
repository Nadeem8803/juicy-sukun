import { isDevMode } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';
import { BACKEND, type CustomerBackend } from './app/core/backend';

async function pickBackend(): Promise<CustomerBackend> {
  // The in-memory demo only exists in development builds (`ng serve` + `?demo`); production always uses Firebase.
  if (isDevMode() && new URLSearchParams(location.search).has('demo')) {
    const { MemoryBackend } = await import('./app/core/memory-backend');
    return new MemoryBackend();
  }
  const { FirebaseBackend } = await import('./app/core/firebase-backend');
  return new FirebaseBackend();
}

pickBackend()
  .then((backend) =>
    bootstrapApplication(App, { ...appConfig, providers: [...appConfig.providers, { provide: BACKEND, useValue: backend }] }),
  )
  .catch((err) => console.error(err));
