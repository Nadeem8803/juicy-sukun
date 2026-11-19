/**
 * Security-rules tests. Run against the Firestore + Storage emulators:
 *   npm run test:integration   (from the repo root)
 */
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { collection, deleteDoc, doc, getDoc, getDocs, setDoc, updateDoc } from 'firebase/firestore';
import { deleteObject, ref, uploadBytes } from 'firebase/storage';

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');

function hostPort(envName: string, fallback: [string, number]): { host: string; port: number } {
  const v = process.env[envName];
  if (!v) return { host: fallback[0], port: fallback[1] };
  const [host, port] = v.split(':');
  return { host, port: Number(port) };
}

let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-juicysukun-rules',
    firestore: { rules: read('../../firestore.rules'), ...hostPort('FIRESTORE_EMULATOR_HOST', ['127.0.0.1', 8080]) },
    storage: { rules: read('../../storage.rules'), ...hostPort('FIREBASE_STORAGE_EMULATOR_HOST', ['127.0.0.1', 9199]) },
  });
});

afterAll(async () => {
  await env.cleanup();
});

const goodItem = {
  name: 'Veg Burger',
  category: 'Burgers',
  sizes: [{ label: '', price: 95 }],
  available: true,
  sort: 2001,
};

const anon = () => env.authenticatedContext('customer-1', { firebase: { sign_in_provider: 'anonymous' } });
const other = () => env.authenticatedContext('customer-2', { firebase: { sign_in_provider: 'anonymous' } });
const owner = () => env.authenticatedContext('owner', { admin: true });

beforeEach(async () => {
  await env.clearFirestore();
  await env.clearStorage();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'menu/burger'), goodItem);
    await setDoc(doc(db, 'shop/status'), { open: true });
    await setDoc(doc(db, 'config/public'), {
      cafeName: 'Juicysukun Café',
      freeDeliveryMin: 300,
      deliveryFee: 39,
      maxLines: 30,
      maxQtyPerLine: 20,
    });
    await setDoc(doc(db, 'config/private'), {
      cafePhone: '9000000000',
      cafeAddress: 'Akkalkot',
      fssai: '1',
      orderTimeoutMinutes: 5,
    });
    await setDoc(doc(db, 'orders/o1'), { customerUid: 'customer-1', status: 'pending', total: 119 });
    await setDoc(doc(db, 'meta/counters'), { order: 1001 });
    await setDoc(doc(db, 'adminTokens/tok'), { uid: 'owner' });
    await setDoc(doc(db, 'blockedPhones/9876543210'), { at: 1 });
  });
});

describe('what customers can read', () => {
  it('menu, shop status and public config are public', async () => {
    const db = anon().firestore();
    await assertSucceeds(getDoc(doc(db, 'menu/burger')));
    await assertSucceeds(getDocs(collection(db, 'menu')));
    await assertSucceeds(getDoc(doc(db, 'shop/status')));
    await assertSucceeds(getDoc(doc(db, 'config/public')));
  });

  it('private config (cafe phone), tokens, blocked numbers and counters are not', async () => {
    const db = anon().firestore();
    await assertFails(getDoc(doc(db, 'config/private')));
    await assertFails(getDoc(doc(db, 'adminTokens/tok')));
    await assertFails(getDoc(doc(db, 'blockedPhones/9876543210')));
    await assertFails(getDoc(doc(db, 'meta/counters')));
  });

  it('even a signed-out visitor can see the menu', async () => {
    const db = env.unauthenticatedContext().firestore();
    await assertSucceeds(getDoc(doc(db, 'menu/burger')));
    await assertFails(getDoc(doc(db, 'orders/o1')));
  });
});

describe('orders', () => {
  it('a customer can read their own order but not someone else’s', async () => {
    await assertSucceeds(getDoc(doc(anon().firestore(), 'orders/o1')));
    await assertFails(getDoc(doc(other().firestore(), 'orders/o1')));
  });

  it('a customer cannot list orders', async () => {
    await assertFails(getDocs(collection(anon().firestore(), 'orders')));
  });

  it('nobody can create or change orders from a client, not even the owner', async () => {
    await assertFails(setDoc(doc(anon().firestore(), 'orders/new'), { customerUid: 'customer-1', total: 1 }));
    await assertFails(updateDoc(doc(anon().firestore(), 'orders/o1'), { status: 'accepted' }));
    await assertFails(updateDoc(doc(owner().firestore(), 'orders/o1'), { status: 'accepted' }));
    await assertFails(deleteDoc(doc(owner().firestore(), 'orders/o1')));
  });

  it('the owner can read and list every order', async () => {
    await assertSucceeds(getDoc(doc(owner().firestore(), 'orders/o1')));
    await assertSucceeds(getDocs(collection(owner().firestore(), 'orders')));
  });
});

describe('what only the owner can change', () => {
  it('customers cannot edit the menu, shop status or config', async () => {
    const db = anon().firestore();
    await assertFails(setDoc(doc(db, 'menu/burger'), { ...goodItem, sizes: [{ label: '', price: 1 }] }));
    await assertFails(setDoc(doc(db, 'menu/new'), goodItem));
    await assertFails(deleteDoc(doc(db, 'menu/burger')));
    await assertFails(setDoc(doc(db, 'shop/status'), { open: false }));
    await assertFails(setDoc(doc(db, 'config/public'), { cafeName: 'x', freeDeliveryMin: 0, deliveryFee: 0, maxLines: 1, maxQtyPerLine: 1 }));
    await assertFails(setDoc(doc(db, 'adminTokens/mine'), { uid: 'customer-1' }));
  });

  it('the owner can add, edit and delete menu items', async () => {
    const db = owner().firestore();
    await assertSucceeds(setDoc(doc(db, 'menu/new'), { ...goodItem, special: true, imageUrl: null }));
    await assertSucceeds(updateDoc(doc(db, 'menu/burger'), { available: false }));
    await assertSucceeds(
      setDoc(doc(db, 'menu/pizza'), {
        ...goodItem,
        name: 'Pizza',
        sizes: [{ label: 'Regular', price: 159 }, { label: 'Medium', price: 269 }],
      }),
    );
    await assertSucceeds(deleteDoc(doc(db, 'menu/burger')));
  });

  it('the owner cannot save a nonsense menu item', async () => {
    const db = owner().firestore();
    await assertFails(setDoc(doc(db, 'menu/a'), { ...goodItem, sizes: [{ label: '', price: 0 }] }));
    await assertFails(setDoc(doc(db, 'menu/b'), { ...goodItem, sizes: [{ label: '', price: -5 }] }));
    await assertFails(setDoc(doc(db, 'menu/c'), { ...goodItem, sizes: [] }));
    await assertFails(
      setDoc(doc(db, 'menu/d'), { ...goodItem, sizes: [{ label: 'a', price: 1 }, { label: 'b', price: 2 }, { label: 'c', price: 3 }] }),
    );
    await assertFails(setDoc(doc(db, 'menu/e'), { ...goodItem, name: '' }));
    await assertFails(setDoc(doc(db, 'menu/f'), { ...goodItem, price: 1 }));
    await assertFails(setDoc(doc(db, 'menu/g'), { ...goodItem, available: 'yes' }));
  });

  it('the owner can go online/offline, change settings, register a device and block a number', async () => {
    const db = owner().firestore();
    await assertSucceeds(setDoc(doc(db, 'shop/status'), { open: false, message: 'Back at 6 pm', updatedAt: Date.now() }));
    await assertFails(setDoc(doc(db, 'shop/status'), { open: 'maybe' }));
    await assertFails(setDoc(doc(db, 'shop/status'), { open: true, extra: 1 }));
    await assertSucceeds(
      setDoc(doc(db, 'config/public'), { cafeName: 'Juicysukun Café', freeDeliveryMin: 350, deliveryFee: 49, maxLines: 30, maxQtyPerLine: 20 }),
    );
    await assertFails(
      setDoc(doc(db, 'config/public'), { cafeName: 'Juicysukun Café', freeDeliveryMin: -1, deliveryFee: 49, maxLines: 30, maxQtyPerLine: 20 }),
    );
    await assertSucceeds(getDoc(doc(db, 'config/private')));
    await assertSucceeds(setDoc(doc(db, 'adminTokens/newtoken'), { uid: 'owner', updatedAt: 1 }));
    await assertSucceeds(setDoc(doc(db, 'blockedPhones/9000000001'), { at: 1 }));
  });

  it('no one can touch the counters from a client', async () => {
    await assertFails(setDoc(doc(owner().firestore(), 'meta/counters'), { order: 5 }));
  });
});

describe('menu photos (Storage)', () => {
  const smallImage = () => new Uint8Array(2000);

  it('the owner can upload and delete a small image', async () => {
    const storage = owner().storage();
    await assertSucceeds(uploadBytes(ref(storage, 'menu/burger.webp'), smallImage(), { contentType: 'image/webp' }));
    await assertSucceeds(deleteObject(ref(storage, 'menu/burger.webp')));
  });

  it('customers cannot upload', async () => {
    await assertFails(uploadBytes(ref(anon().storage(), 'menu/x.webp'), smallImage(), { contentType: 'image/webp' }));
  });

  it('the owner cannot upload a non-image or an image over 1 MB', async () => {
    const storage = owner().storage();
    await assertFails(uploadBytes(ref(storage, 'menu/x.txt'), smallImage(), { contentType: 'text/plain' }));
    await assertFails(uploadBytes(ref(storage, 'menu/big.webp'), new Uint8Array(1024 * 1024 + 1), { contentType: 'image/webp' }));
  });

  it('uploads outside /menu are refused', async () => {
    await assertFails(uploadBytes(ref(owner().storage(), 'other/x.webp'), smallImage(), { contentType: 'image/webp' }));
  });
});
