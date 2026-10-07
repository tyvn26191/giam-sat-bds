// Bundle the worker (and the workspace packages it uses) into dist/index.js.
// Heavy runtime libraries stay external and are installed in the image with `npm ci --omit=dev`.
import { build } from 'esbuild';

await build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  outfile: 'dist/index.js',
  sourcemap: true,
  legalComments: 'none',
  external: ['firebase-admin', 'firebase-admin/*', 'google-auth-library', 'playwright-core', 'nodemailer'],
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  logLevel: 'info',
});
