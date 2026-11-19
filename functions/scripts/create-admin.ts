/**
 * Creates the owner's login (or upgrades an existing user) and gives it the `admin` claim.
 *
 *   npm run create-admin -- owner@example.com "a-strong-password"
 *
 * Only accounts with this claim can use the admin app, edit the menu or read every order.
 * Customers never get it.
 */
import { getAuth } from 'firebase-admin/auth';
import { initAdmin, parseArgs } from './util';

async function main(): Promise<void> {
  const { positional } = parseArgs(process.argv.slice(2));
  const [email, password] = positional;
  if (!email || !/^\S+@\S+\.\S+$/.test(email)) throw new Error('Usage: npm run create-admin -- <email> "<password>"');

  initAdmin();
  const auth = getAuth();

  let uid: string;
  try {
    uid = (await auth.getUserByEmail(email)).uid;
    console.log(`User ${email} already exists.`);
    if (password) await auth.updateUser(uid, { password });
  } catch (e) {
    if ((e as { code?: string }).code !== 'auth/user-not-found') throw e;
    if (!password || password.length < 8) throw new Error('New user: give a password of at least 8 characters.');
    uid = (await auth.createUser({ email, password, emailVerified: true })).uid;
    console.log(`Created user ${email}.`);
  }

  await auth.setCustomUserClaims(uid, { admin: true });
  console.log(`Done. ${email} (uid ${uid}) is now the owner. They must sign in again to pick up the claim.`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
