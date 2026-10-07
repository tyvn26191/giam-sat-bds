// Local stack: Firebase emulators (Auth + Firestore) running scripts/dev-stack.mjs inside.
// Nothing here touches a real Firebase project or real property sites.
import { spawn } from 'node:child_process';

const child = spawn(
  'npx',
  ['firebase', 'emulators:exec', '--only', 'auth,firestore', '--project', 'demo-gsb', '"node scripts/dev-stack.mjs"'],
  { stdio: 'inherit', shell: true },
);
child.on('exit', (code) => process.exit(code ?? 0));
