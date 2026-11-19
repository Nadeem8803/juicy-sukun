#!/usr/bin/env node
/**
 * Builds the owner app APK.   npm run apk            -> debug APK (easiest; installs fine over WhatsApp)
 *                             npm run apk:release    -> release APK (needs a keystore, see README)
 * Steps: build the Angular admin app -> copy it into the Android project -> Gradle.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

const release = process.argv[2] === 'release';
const win = process.platform === 'win32';
const run = (cmd, args, opts = {}) => {
  const r = spawnSync(cmd, args, { stdio: 'inherit', shell: win, ...opts });
  if (r.status !== 0) {
    console.error(`\n✖ "${cmd} ${args.join(' ')}" failed. See the messages above, and README → Troubleshooting.`);
    process.exit(r.status ?? 1);
  }
};

if (!existsSync('android/app/google-services.json')) {
  console.warn(
    '\n⚠ android/app/google-services.json is missing.\n' +
      '  The APK will build, but the phone will NOT ring when the app is closed (no push).\n' +
      '  Add the file (README step 4) and run this again.\n',
  );
}

run('npx', ['ng', 'build', 'admin']);
run('npx', ['cap', 'sync', 'android']);
run(win ? 'gradlew.bat' : './gradlew', [release ? 'assembleRelease' : 'assembleDebug'], { cwd: 'android' });

const apk = release
  ? 'android/app/build/outputs/apk/release/app-release.apk'
  : 'android/app/build/outputs/apk/debug/app-debug.apk';
const unsigned = 'android/app/build/outputs/apk/release/app-release-unsigned.apk';
const found = [apk, unsigned].find((p) => existsSync(p));
if (found) console.log(`\n✔ Done: ${join(process.cwd(), found)} (${(statSync(found).size / 1e6).toFixed(1)} MB)\n  Send this file on WhatsApp and install it on the owner's phone.`);
else console.log('\nBuild finished but the APK was not found where expected; look under android/app/build/outputs/apk.');
