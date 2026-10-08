// Copies the files the live site needs into _site/ (used by GitHub Pages and Vercel).
// Run: node scripts/assemble-site.mjs

import { cp, rm } from 'node:fs/promises';

const root = new URL('..', import.meta.url);
const out = new URL('_site/', root);

await rm(out, { recursive: true, force: true });
for (const path of ['index.html', 'src', 'public']) {
  await cp(new URL(path, root), new URL(path, out), {
    recursive: true,
    filter: (src) => !src.endsWith('.test.js'),
  });
}
console.log('Assembled _site/');
