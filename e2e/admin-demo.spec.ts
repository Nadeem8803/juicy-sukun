import { expect, test, type Page } from '@playwright/test';

/** Owner journey against the in-memory demo backend (`?demo`, password demo1234). */

const demo = (page: Page, js: string) => page.evaluate(`window.__demo.${js}`);

test.beforeEach(async ({ page }) => {
  await page.goto('/?demo');
  await page.getByTestId('email').fill('owner@juicysukun.test');
  await page.getByTestId('password').fill('demo1234');
  await page.getByTestId('sign-in').click();
  await expect(page.getByTestId('shop-toggle')).toBeVisible();
});

test('wrong password is refused', async ({ page }) => {
  await page.getByRole('link', { name: /Settings/ }).click();
  await page.getByTestId('logout').click();
  await page.getByTestId('email').fill('owner@juicysukun.test');
  await page.getByTestId('password').fill('nope');
  await page.getByTestId('sign-in').click();
  await expect(page.getByTestId('login-error')).toContainText('Wrong email or password');
});

test('go online / offline', async ({ page }) => {
  const toggle = page.getByTestId('shop-toggle');
  await expect(toggle).toContainText('OFFLINE');
  await toggle.click();
  await expect(toggle).toContainText('ONLINE');
  await toggle.click(); // asks for confirmation
  await page.getByTestId('confirm-offline').click();
  await expect(toggle).toContainText('OFFLINE');
});

test('new order rings until accepted, then shows customer details', async ({ page }) => {
  await demo(page, 'newOrder()');
  const card = page.getByTestId('order-JS-1001');
  await expect(card).toBeVisible();
  await expect(page.getByTestId('pending-count')).toHaveText('1');
  await expect(card).toContainText('Ayesha Shaikh');
  await expect(card.getByTestId('call')).toHaveCount(0); // phone hidden until accepted
  await page.screenshot({ path: 'e2e/screens/admin-ringing.png' });

  await card.getByTestId('accept').click();
  await expect(page.getByTestId('pending-count')).toHaveCount(0);
  await page.getByTestId('tab-active').click();
  const active = page.getByTestId('order-JS-1001');
  await expect(active.getByTestId('call')).toHaveAttribute('href', 'tel:9876543210');
  await expect(active.getByTestId('navigate')).toHaveAttribute('href', /destination=17\.5236,76\.2043/);
  await page.screenshot({ path: 'e2e/screens/admin-accepted.png' });

  await active.getByTestId('next').click(); // preparing
  await expect(active).toContainText('Preparing');
});

test('rejecting needs a reason of at least 3 characters', async ({ page }) => {
  await demo(page, 'newOrder()');
  const card = page.getByTestId('order-JS-1001');
  await card.getByTestId('reject').click();
  await expect(page.getByTestId('reason-confirm')).toBeDisabled();
  await page.getByTestId('reason').fill('ab');
  await expect(page.getByTestId('reason-confirm')).toBeDisabled();
  await page.getByRole('button', { name: 'Item out of stock' }).click();
  await page.getByTestId('reason-confirm').click();
  await expect(page.getByTestId('pending-count')).toHaveCount(0);
  await page.getByTestId('tab-history').click();
  await expect(page.getByTestId('order-JS-1001')).toContainText('Reason: Item out of stock');
});

test('the siren runs while an order waits and stops when it is handled', async ({ page }) => {
  await page.evaluate(() => {
    (window as any).__beeps = 0;
    const real = AudioContext.prototype.createOscillator;
    AudioContext.prototype.createOscillator = function () {
      (window as any).__beeps++;
      return real.call(this);
    };
  });

  await demo(page, 'newOrder()');
  await expect.poll(() => page.evaluate(() => (window as any).__beeps)).toBeGreaterThan(4);
  await page.getByTestId('order-JS-1001').getByTestId('accept').click();
  const after = await page.evaluate(() => (window as any).__beeps);
  await page.waitForTimeout(2500);
  expect(await page.evaluate(() => (window as any).__beeps)).toBe(after); // silent again
});

test('menu: edit a price, mark sold out, add and delete an item', async ({ page }) => {
  await page.getByRole('link', { name: /Menu/ }).click();
  await expect(page.getByTestId('row-drinks-blue-mint')).toBeVisible();

  await page.getByTestId('row-drinks-blue-mint').getByRole('button', { name: 'Edit Blue Mint' }).click();
  await page.getByTestId('ed-price1').fill('95');
  await page.getByTestId('save-item').click();
  await expect(page.getByTestId('row-drinks-blue-mint')).toContainText('₹95');

  await page.getByTestId('avail-drinks-blue-mint').click();
  await expect(page.getByTestId('row-drinks-blue-mint')).toContainText('Sold out');

  await page.getByTestId('add-item').click();
  await page.getByTestId('save-item').click();
  await expect(page.getByText('Enter the item name.')).toBeVisible();
  await page.getByTestId('ed-name').fill('Mango Shake');
  await page.getByTestId('ed-category').selectOption('Drinks');
  await page.getByTestId('ed-price1').fill('110');
  await page.getByTestId('save-item').click();
  await expect(page.getByTestId('row-drinks-mango-shake')).toContainText('₹110');

  await page.getByTestId('row-drinks-mango-shake').getByRole('button', { name: 'Edit Mango Shake' }).click();
  await page.getByTestId('delete-item').click();
  await page.getByTestId('delete-item').click();
  await expect(page.getByTestId('row-drinks-mango-shake')).toHaveCount(0);
});
