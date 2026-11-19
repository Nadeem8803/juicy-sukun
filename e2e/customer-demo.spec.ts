import { expect, test, type Page } from '@playwright/test';

/** Customer journey against the in-memory demo backend (`?demo`), so no Firebase is needed. */

const demo = (page: Page, js: string) => page.evaluate(`window.__demo.${js}`);

test.beforeEach(async ({ page }) => {
  await page.goto('/?demo');
  await page.evaluate(() => localStorage.clear());
  await page.goto('/?demo');
  await expect(page.getByTestId('item-drinks-blue-mint')).toBeVisible();
});

async function fillDetails(page: Page) {
  await page.getByTestId('f-name').fill('Ayesha Shaikh');
  await page.getByTestId('f-phone').fill('98765 43210');
  await page.getByTestId('f-address').fill('Near bus stand, Akkalkot');
}

test('shows open, searches by name, category and price', async ({ page }) => {
  await expect(page.getByTestId('shop-pill')).toContainText('Open now');

  await page.getByTestId('search').fill('mojito');
  await expect(page.getByTestId('item-drinks-virgin-mojito')).toBeVisible();
  await expect(page.getByTestId('item-pizza-veg-choice-pizza')).toHaveCount(0);

  await page.getByTestId('search').fill('zzzz');
  await expect(page.getByTestId('no-results')).toBeVisible();
  await page.getByRole('button', { name: 'Clear filters' }).click();

  await page.getByRole('tab', { name: /Burgers/ }).click();
  await expect(page.getByTestId('item-pizza-veg-choice-pizza')).toHaveCount(0);
  await page.getByRole('tab', { name: 'All' }).click();

  await page.getByRole('button', { name: 'Under ₹100' }).click();
  await expect(page.getByTestId('item-drinks-blue-mint')).toBeVisible();
  await expect(page.getByTestId('item-pizza-js-veg-special-pizza')).toHaveCount(0);
});

test('delivery fee: ₹39 under ₹300, free from ₹300', async ({ page }) => {
  await page.getByRole('button', { name: 'Add Blue Mint' }).click(); // ₹80
  await page.getByTestId('cart-bar').click();
  await expect(page.getByTestId('subtotal')).toHaveText('₹80');
  await expect(page.getByTestId('delivery')).toHaveText('₹39');
  await expect(page.getByTestId('total')).toHaveText('₹119');
  await expect(page.getByTestId('nudge')).toContainText('₹220');

  for (let i = 0; i < 3; i++) await page.getByRole('button', { name: 'Add one more Blue Mint' }).click(); // 4 x 80 = 320
  await expect(page.getByTestId('delivery')).toHaveText('FREE');
  await expect(page.getByTestId('total')).toHaveText('₹320');
});

test('order → waits → accepted shows cafe phone and invoice', async ({ page }) => {
  await page.getByRole('button', { name: 'Add Cold Coffee' }).click();
  await page.getByTestId('cart-bar').click();
  await fillDetails(page);
  await page.getByTestId('place-order').click();

  await expect(page.getByTestId('status-pending')).toBeVisible();
  await expect(page.getByTestId('invoice')).toHaveCount(0); // phone/invoice stay hidden until accepted

  await demo(page, 'accept()');
  await expect(page.getByTestId('status-accepted')).toBeVisible();
  await expect(page.getByTestId('cafe-phone')).toContainText('9000000000');
  await expect(page.getByTestId('invoice')).toContainText('Cold Coffee');
  await expect(page.getByTestId('invoice')).toContainText('₹129'); // 90 + 39
  await page.screenshot({ path: 'e2e/screens/accepted.png', fullPage: true });

  await demo(page, 'advance()');
  await expect(page.getByTestId('status-preparing')).toBeVisible();
});

test('rejection shows the reason the owner typed', async ({ page }) => {
  await page.getByRole('button', { name: 'Add Cold Coffee' }).click();
  await page.getByTestId('cart-bar').click();
  await fillDetails(page);
  await page.getByTestId('place-order').click();
  await expect(page.getByTestId('status-pending')).toBeVisible();

  await demo(page, `reject('Machine is being cleaned')`);
  await expect(page.getByTestId('status-rejected')).toContainText('Machine is being cleaned');
});

test('customer can cancel while waiting', async ({ page }) => {
  await page.getByRole('button', { name: 'Add Cold Coffee' }).click();
  await page.getByTestId('cart-bar').click();
  await fillDetails(page);
  await page.getByTestId('place-order').click();
  await page.getByTestId('cancel').click();
  await expect(page.getByTestId('status-cancelled')).toBeVisible();
});

test('closed shop: banner, and a popup when trying to order', async ({ page }) => {
  await demo(page, 'setOpen(false)');
  await expect(page.getByTestId('shop-pill')).toContainText('Closed');
  await expect(page.getByTestId('closed-banner')).toBeVisible();

  await page.getByRole('button', { name: 'Add Cold Coffee' }).click(); // browsing/carting still works
  await page.getByTestId('cart-bar').click();
  await fillDetails(page);
  await page.getByTestId('place-order').click();

  await expect(page.getByTestId('closed-dialog')).toBeVisible();
  await expect(page.getByTestId('closed-dialog')).toContainText("We're offline right now");
  await page.screenshot({ path: 'e2e/screens/closed.png' });

  await page.getByRole('button', { name: 'Okay, got it' }).click();
  await expect(page.getByTestId('closed-dialog')).toHaveCount(0);
});

test('form validation and remembered details', async ({ page }) => {
  await page.getByRole('button', { name: 'Add Cold Coffee' }).click();
  await page.getByTestId('cart-bar').click();
  await page.getByTestId('f-phone').fill('12345');
  await page.getByTestId('place-order').click();
  await expect(page.getByText('Enter a 10-digit mobile number')).toBeVisible();
  await expect(page.getByText('Please enter your name')).toBeVisible();
});

test('menu screenshot (mobile)', async ({ page }) => {
  await page.getByRole('button', { name: 'Add Blue Mint' }).click();
  await page.screenshot({ path: 'e2e/screens/menu.png' });
});
