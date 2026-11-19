import { DestroyRef, effect, inject, type Signal } from '@angular/core';

/**
 * Makes the phone's Back button close a popup instead of leaving the page / closing the app.
 * Call once from a component constructor or field initialiser.
 */
export function closeOnBack(isOpen: Signal<boolean>, close: () => void): void {
  let pushed = false;
  const onPop = (): void => {
    if (!pushed) return;
    pushed = false;
    close();
  };
  window.addEventListener('popstate', onPop);
  inject(DestroyRef).onDestroy(() => {
    window.removeEventListener('popstate', onPop);
    if (pushed) {
      pushed = false;
      history.back();
    }
  });
  effect(() => {
    const open = isOpen();
    if (open && !pushed) {
      history.pushState({ ...(history.state ?? {}), overlay: true }, '');
      pushed = true;
    } else if (!open && pushed) {
      pushed = false;
      history.back();
    }
  });
}
