# Juicysukun Café — online ordering

Two apps and a small backend, all on Firebase (free `juicysukun.web.app` address, Mumbai region):

| Part | What it is | Where |
|---|---|---|
| **Customer PWA** | Menu, search, cart, order tracking, invoice. Installable on the phone's home screen. | `projects/customer` → hosted at `https://<project-id>.web.app` |
| **Owner app (APK)** | Rings loudly on new orders, accept / reject with reason, online/offline switch, menu + price editor. Shared on WhatsApp, not hosted. | `projects/admin` + `android/` |
| **Backend** | Cloud Functions (place order, change status, 5-min auto-expire, push to owner's phone), Firestore rules, Storage rules. | `functions/`, `firestore.rules`, `storage.rules` |
| **Shared rules** | Pricing (₹39 under ₹300, free from ₹300), order status machine, validation, the 50-item menu. Written once, used by both apps and the server. | `projects/shared` |

**Business rules:** cash on delivery only · Akkalkot only (no radius check) · owner-only login · customers need no login/OTP (anonymous) · prices are always calculated on the server · an order waits for the owner; the cafe phone number and invoice appear to the customer only after acceptance · unanswered orders expire after 5 minutes.

---

## 0. What you need on your computer

- **Node.js 22** (`node -v`) and npm
- **Firebase CLI**: `npm i -g firebase-tools`
- **Java 21 (JDK)** and the **Android SDK** — easiest is to install **Android Studio** once (it brings both). Set `ANDROID_HOME` if Gradle can't find the SDK (Android Studio → SDK Manager shows the path), or create `android/local.properties` with `sdk.dir=/path/to/Android/sdk`.
- A Google account that will **own the Firebase project** (the client's, as agreed).

## 1. Install and try it with no Firebase at all (2 minutes)

```bash
npm run setup                 # installs the app + the functions folder
npm run start:customer        # open http://localhost:4200/?demo
npm run start:admin           # open http://localhost:4201/?demo   (any email, password: demo1234)
```

`?demo` runs everything in memory. In the customer tab open the browser console and type `__demo.accept()` / `__demo.reject('Out of stock')` to play the owner; in the admin tab type `__demo.newOrder()` to play a customer and hear the siren. (`?demo` only works in `npm start`, never in production builds.)

## 2. Run the tests

```bash
npm test                  # shared rules + functions + both Angular apps (unit tests)
npm run e2e               # browser tests in demo mode (needs Chrome: npx playwright install chromium)
npm run test:integration  # security rules + real Cloud Functions in the Firebase emulators
npm run e2e:full          # customer app + owner app + emulators, end to end
```

The last two start the Firebase emulators (needs Java and `firebase-tools`; the first run downloads the emulator jars).

## 3. Create the Firebase project (one time, in the client's Google account)

1. <https://console.firebase.google.com> → **Add project** → name e.g. *Juicysukun Café*. Note the **Project ID** (that becomes `<id>.web.app`; pick something like `juicysukun`).
2. **Upgrade to the Blaze plan** (pay-as-you-go). Cloud Functions need it. For a single café it should stay at or near ₹0; still, in Google Cloud Billing → **Budgets & alerts**, add a ₹500 budget alert.
3. **Build → Authentication → Get started**: enable **Email/Password** and **Anonymous**.
4. **Build → Firestore Database → Create**: *production mode*, location **asia-south1 (Mumbai)**.
5. **Build → Storage → Get started** (choose the same region).
6. **Project settings → Your apps → Web (`</>`)** → register an app → copy the `firebaseConfig` values into **both**:
   - `projects/customer/src/app/core/firebase-config.ts`
   - `projects/admin/src/app/core/firebase-config.ts`
7. Point the CLI at the project:
   ```bash
   firebase login
   firebase use --add          # pick the project; alias "default"
   ```
   (or edit `.firebaserc`).

## 4. Deploy the backend and the customer site

```bash
npm run deploy      # builds the customer PWA + functions, then deploys rules, functions and hosting
```

The first deploy of functions may ask you to enable a few Google APIs (accept) and can take a few minutes. Afterwards the customer site is live at `https://<project-id>.web.app`.

## 5. Load the menu and create the owner login

The seed script and the owner-account script need a service-account key:

1. Firebase console → **Project settings → Service accounts → Generate new private key**. Save the file **outside** the project folder.
2. In the terminal (macOS/Linux): `export GOOGLE_APPLICATION_CREDENTIALS=/full/path/to/key.json` — Windows PowerShell: `$env:GOOGLE_APPLICATION_CREDENTIALS="C:\full\path\key.json"`
3. ```bash
   npm run seed -- --phone=9XXXXXXXXX --address="Shop address, Akkalkot" --fssai=XXXXXXXXXXXXXX
   npm run create-admin -- owner@example.com "a-strong-password"
   ```
   The seed loads the 50-item menu, delivery settings (₹39 / free from ₹300) and a **closed** shop. It is safe to run again (it won't overwrite the owner's edits; add `--force` to reset). The phone number is what customers see after acceptance.
4. **Delete the key file** when done.

## 6. Build the owner APK

1. Firebase console → **Project settings → Your apps → Add app → Android**. Package name: **`com.juicysukun.admin`** (nickname anything; skip SHA-1). Download **`google-services.json`** and put it at **`android/app/google-services.json`**. (Without it the app still works while open, but there is no push, so no ringing when closed.)
2. ```bash
   npm run apk
   ```
   This builds the admin app, copies it into the Android project and runs Gradle. The first run downloads Gradle and Android libraries (several hundred MB, 5–15 minutes). The result:

   `android/app/build/outputs/apk/debug/app-debug.apk`

3. **Send that file to the owner on WhatsApp.** On the phone: open it → allow "Install unknown apps" for WhatsApp/Files when asked → Install.

> The debug APK is signed with a debug key, which is fine for one private phone. If you want a properly signed release build: create a keystore (`keytool -genkey -v -keystore juicysukun.keystore -alias js -keyalg RSA -keysize 2048 -validity 10000`), add a `signingConfigs` block to `android/app/build.gradle`, and run `npm run apk:release`. **Keep the keystore and its password safe**; updates must be signed with the same one.

### First run on the owner's phone (2 minutes, do it together)

1. Sign in with the owner email/password.
2. **Settings → Order alarm**: tap *Allow* next to each ✖ until all three are ✔ (notifications, show over lock screen, battery unrestricted).
3. Tap **Test the alarm** — it should be very loud and keep ringing until you tap **Stop test** (shown below the button).
4. Phones from Xiaomi, Oppo, Vivo, Realme, OnePlus and Samsung also have their own "autostart / battery saver" screens: allow autostart and set battery to *No restrictions* for Juicysukun Owner, and lock the app in the recents screen. This is the #1 reason alarms fail on these phones.
5. Press **OFFLINE → ONLINE** when the café opens.

## 7. Go-live checklist

- [ ] Open the customer site on a phone, **Add to Home screen**, place a real test order, accept it on the owner phone, check the invoice shows the right café number.
- [ ] Reject a test order → the reason you type shows on the customer's screen.
- [ ] Switch to OFFLINE → the customer site shows *Closed* and the popup appears on "Place order".
- [ ] Put the owner phone on the lock screen, place an order from another phone → it rings, screen lights, tapping opens the order.
- [ ] Replace the placeholder icons (`projects/customer/public/icons/*.png`) with the café's logo; rebuild + `npm run deploy`.
- [ ] Optional: attach a custom domain in Firebase Hosting; enable **App Check** (reCAPTCHA) and set `ENFORCE_APP_CHECK=true` in `functions/.env` to stop bots.

## Using the owner app

- **Orders → New**: pending orders ring until you Accept or Reject. *Reject* needs a reason (quick chips or type your own) — the customer sees it. After accepting, you see name, **phone (tap to call)** and **map location (tap to navigate)**; move the order through *Start preparing → Out for delivery → Mark delivered*.
- **Menu**: tap an item to change its name, category, price(s), photo, ★ special flag; the switch marks it *Sold out* instantly; *+ Add item* creates new ones; photos are compressed on the phone automatically.
- **Settings**: delivery charge / free-delivery amount, café phone, address, FSSAI, auto-reject time, shop message ("Back at 6 pm").

## How it is put together

```
projects/shared    pricing, order state machine, validation, order builder, menu seed   (unit-tested once)
projects/customer  Angular PWA   (signals, zoneless, lazy routes, service worker)
projects/admin     Angular app wrapped by Capacitor
android/           native alarm: AlarmService (foreground, alarm stream, full-screen intent),
                   OrderMessagingService (push → ring), OrderAlarmPlugin (JS bridge)
functions/         placeOrder, changeOrderStatus, onOrderCreated (push), expirePendingOrders (every minute)
e2e/               Playwright specs
```

Security model: customers sign in anonymously and can only *read their own order*; every write to orders goes through Cloud Functions (so a customer can't change a price or accept their own order); only an account with the `admin` claim (created by `create-admin`) can edit the menu, settings or read all orders.

Extras included beyond the brief: customer order tracking + cancel while waiting, 5-minute auto-expiry with push to stop the alarm, WhatsApp-share/print invoice, remembered customer details, install-to-home-screen, offline menu, sold-out switch, daily sales counter, rate limit (max 2 waiting orders per customer) and a blocked-numbers list (`blockedPhones/<10-digit number>` in Firestore).

## Troubleshooting

- **`npm run apk` fails with "SDK location not found"** → create `android/local.properties` containing `sdk.dir=/path/to/Android/sdk`.
- **Gradle says Java version mismatch** → install JDK 21 and set `JAVA_HOME` to it.
- **Owner app says "Wrong email or password" for the right password** → run `create-admin` again; sign out and in (the owner flag is read at sign-in).
- **Customer site says it can't reach the café** → functions not deployed yet (`npm run deploy`) or the project isn't on the Blaze plan.
- **Phone doesn't ring when the app is closed** → `google-services.json` missing at build time, or the battery/autostart steps in section 6 not done. Check Settings → Order alarm.
- **On localhost both apps talk to the emulators** (`npm run emulators`), never to production. The built site and the APK use the real project.
- **Menu prices on the printed card changed?** Edit them in the owner app, no rebuild needed.

## Notes on the menu data

The 50 items come from the printed menu with obvious spelling fixes; extras are named "Extra …" with the 7"/10" prices as listed; *Cheese Treat Pizza* has one size (₹159). The veg/non-veg marks on the card were not carried over. Check `projects/shared/src/menu-seed.ts` against the card once, or just fix anything in the owner app's Menu tab.
