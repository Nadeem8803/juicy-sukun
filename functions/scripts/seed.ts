/**
 * Loads the 50-item menu card, the delivery settings and a CLOSED shop into Firestore.
 *
 *   npm run seed -- --phone=9XXXXXXXXX --address="Shop address, Akkalkot" --fssai=XXXXXXXXXXXXXX
 *
 * Safe to run again: existing menu items and settings are left alone so the owner's edits survive.
 * Add --force to overwrite the menu and settings with the printed-card defaults.
 */
import { getFirestore } from 'firebase-admin/firestore';
import { DEFAULT_PRIVATE_CONFIG, DEFAULT_PUBLIC_CONFIG, MENU_SEED, normalizePhone } from '@juicy/shared';
import { initAdmin, parseArgs } from './util';

async function main(): Promise<void> {
  const { flags } = parseArgs(process.argv.slice(2));
  const force = flags['force'] === true;
  initAdmin();
  const db = getFirestore();

  const phoneArg = typeof flags['phone'] === 'string' ? flags['phone'] : '';
  const phone = phoneArg ? normalizePhone(phoneArg) : '';
  if (phoneArg && !phone) throw new Error(`--phone "${phoneArg}" is not a valid 10-digit mobile number`);

  // Menu
  const menuRefs = MENU_SEED.map((m) => db.collection('menu').doc(m.id));
  const existing = await db.getAll(...menuRefs);
  const batch = db.batch();
  let written = 0;
  MENU_SEED.forEach((item, i) => {
    if (existing[i].exists && !force) return;
    const { id: _id, ...data } = item;
    batch.set(menuRefs[i], data);
    written += 1;
  });

  // Settings (never overwrite what the owner already changed, unless --force)
  const pubRef = db.doc('config/public');
  const privRef = db.doc('config/private');
  const shopRef = db.doc('shop/status');
  const [pub, priv, shop] = await Promise.all([pubRef.get(), privRef.get(), shopRef.get()]);
  if (!pub.exists || force) batch.set(pubRef, DEFAULT_PUBLIC_CONFIG);
  if (!priv.exists || force) {
    batch.set(privRef, {
      ...DEFAULT_PRIVATE_CONFIG,
      ...(phone ? { cafePhone: phone } : {}),
      ...(typeof flags['address'] === 'string' ? { cafeAddress: flags['address'] } : {}),
      ...(typeof flags['fssai'] === 'string' ? { fssai: flags['fssai'] } : {}),
    });
  }
  if (!shop.exists) batch.set(shopRef, { open: false, updatedAt: Date.now() });

  await batch.commit();
  console.log(`Menu: wrote ${written} of ${MENU_SEED.length} items${force ? ' (forced)' : ''}.`);
  console.log(`Settings: public ${pub.exists && !force ? 'kept' : 'written'}, private ${priv.exists && !force ? 'kept' : 'written'}.`);
  console.log(`Shop status: ${shop.exists ? (shop.data()?.['open'] ? 'OPEN (unchanged)' : 'closed (unchanged)') : 'created as closed'}.`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
