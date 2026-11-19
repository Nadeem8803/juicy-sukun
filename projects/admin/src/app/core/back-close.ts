import { effect, type Signal } from '@angular/core';

/** Open popups, newest last. The phone's Back button closes the newest one first. */
const stack: (() => void)[] = [];

/** Closes the newest open popup. Returns false when there is none. */
export function closeTopOverlay(): boolean {
  const top = stack.pop();
  if (!top) return false;
  top();
  return true;
}

/** Registers a popup while it is open so the Back button closes it. Call once from a component field initialiser. */
export function closeOnBack(isOpen: Signal<boolean>, close: () => void): void {
  effect((onCleanup) => {
    if (!isOpen()) return;
    stack.push(close);
    onCleanup(() => {
      const i = stack.lastIndexOf(close);
      if (i >= 0) stack.splice(i, 1);
    });
  });
}
