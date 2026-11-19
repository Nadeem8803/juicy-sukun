import { devices, expect, test } from '@playwright/test';

/**
 * Real thing: customer PWA + owner app + Firebase emulators (Auth, Firestore, Functions, Storage).
 * Run with `npm run e2e:full` (it starts the emulators and seeds the menu + an owner account).
 */
const OWNER = { email: 'owner@juicysukun.test', password: 'owner-pass-123' };

test('customer order → owner accepts → customer sees phone + invoice; second order rejected with reason', async ({ page: customer, browser }) => {
  const adminCtx = await browser.newContext({ ...devices['Pixel 7'], baseURL: 'http://localhost:4201' });
  const admin = await adminCtx.newPage();

  // Owner signs in and opens the shop
  await admin.goto('/');
  await admin.getByTestId('email').fill(OWNER.email);
  await admin.getByTestId('password').fill(OWNER.password);
  await admin.getByTestId('sign-in').click();
  const toggle = admin.getByTestId('shop-toggle');
  await expect(toggle).toBeVisible();
  if ((await toggle.textContent())?.includes('OFFLINE')) await toggle.click();
  await expect(toggle).toContainText('ONLINE');

  // Customer orders
  await customer.goto('/');
  await expect(customer.getByTestId('shop-pill')).toContainText('Open now');
  const place = async () => {
    await customer.goto('/');
    await customer.getByRole('button', { name: 'Add Cold Coffee' }).click();
    await customer.getByTestId('cart-bar').click();
    await customer.getByTestId('f-name').fill('Ayesha Shaikh');
    await customer.getByTestId('f-phone').fill('9876543210');
    await customer.getByTestId('f-address').fill('Near bus stand, Akkalkot');
    await customer.getByTestId('place-order').click();
    await expect(customer.getByTestId('status-pending')).toBeVisible();
  };

  await place();
  const card = admin.getByTestId(/order-JS-/).first();
  await expect(card).toContainText('Cold Coffee');
  await card.getByTestId('accept').click();
  await expect(customer.getByTestId('status-accepted')).toBeVisible();
  await expect(customer.getByTestId('cafe-phone')).toContainText('9000000000');
  await expect(customer.getByTestId('invoice')).toContainText('₹129');

  await admin.getByTestId('tab-active').click();
  await expect(admin.getByTestId('call').first()).toHaveAttribute('href', 'tel:9876543210');

  // Second order is rejected with a reason
  await place();
  await admin.getByTestId('tab-new').click();
  await admin.getByTestId('reject').first().click();
  await admin.getByTestId('reason').fill('Machine is being cleaned');
  await admin.getByTestId('reason-confirm').click();
  await expect(customer.getByTestId('status-rejected')).toContainText('Machine is being cleaned');

  // Owner goes offline: customer can't order
  await admin.getByTestId('shop-toggle').click();
  await admin.getByTestId('confirm-offline').click();
  await expect(customer.getByTestId('shop-pill')).toContainText('Closed');
  await adminCtx.close();
});
