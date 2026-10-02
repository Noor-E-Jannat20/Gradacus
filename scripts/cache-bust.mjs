// Cache busting for index.html: appends ?v=<content-hash> to every local
// <script src> and <link href> (CSS). The hash only changes when the file's
// contents change, so browsers/CDNs re-fetch exactly the files you edited.
//
//   node scripts/cache-bust.mjs      (or: npm run bust)
//
// Safe to run repeatedly; it replaces any existing ?v= value.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const htmlPath = resolve(root, 'index.html');
let html = readFileSync(htmlPath, 'utf8');

const isLocal = url => !/^([a-z]+:)?\/\//i.test(url) && !url.startsWith('data:') && !url.startsWith('#');
const stamped = [];

// <script ... src="x.js"> and <link rel="stylesheet" ... href="x.css">
html = html.replace(
  /(<script\b[^>]*?\ssrc=|<link\b[^>]*?rel=["']stylesheet["'][^>]*?\shref=|<link\b[^>]*?\shref=)(["'])([^"']+?)\2/gi,
  (match, head, quote, url) => {
    if (/<link\b/i.test(head) && !/\.css(\?|$)/i.test(url)) return match;
    if (!isLocal(url)) return match;
    const clean = url.split('?')[0];
    const file = resolve(root, clean);
    if (!existsSync(file)) { console.warn('skip (missing):', clean); return match; }
    const hash = createHash('md5').update(readFileSync(file)).digest('hex').slice(0, 8);
    stamped.push(`${clean} -> v=${hash}`);
    return `${head}${quote}${clean}?v=${hash}${quote}`;
  }
);

writeFileSync(htmlPath, html);
console.log(stamped.length ? 'Cache-busted:\n  ' + stamped.join('\n  ') : 'No local assets found.');
