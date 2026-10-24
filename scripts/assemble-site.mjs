// Copies the files the live site needs into _site/ (used by GitHub Pages and Vercel).
// Run: node scripts/assemble-site.mjs

import { cp, rm, writeFile } from 'node:fs/promises';
import { execSync } from 'node:child_process';

const root = new URL('..', import.meta.url);
const out = new URL('_site/', root);

await rm(out, { recursive: true, force: true });
for (const path of ['index.html', 'src', 'public']) {
  await cp(new URL(path, root), new URL(path, out), {
    recursive: true,
    filter: (src) => !src.endsWith('.test.js'),
  });
}

// Stamp the build with its short commit sha (Vercel and GitHub Actions both provide it).
const sha = process.env.VERCEL_GIT_COMMIT_SHA || process.env.GITHUB_SHA || gitSha();
const version = sha ? sha.slice(0, 7) : new Date().toISOString().slice(0, 10);
await writeFile(new URL('src/version.js', out), `export const APP_VERSION = '${version}';\n`);
console.log(`Assembled _site/ (version ${version})`);

function gitSha() {
  try {
    return execSync('git rev-parse HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return '';
  }
}
