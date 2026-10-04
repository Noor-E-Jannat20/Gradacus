// Generates curriculum-data.js from src/data/curriculum.json so the browser app
// (plain <script> tags, no bundler) reads prerequisites from the SAME data file
// the rest of the project uses — nothing is hard-coded in the UI.
//
//   node scripts/build-curriculum.mjs      (or: npm run data)
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const json = JSON.parse(readFileSync(resolve(root, 'src/data/curriculum.json'), 'utf8'));

// sanity checks: every prerequisite must point at a known course
const unknown = new Set();
for (const [code, c] of Object.entries(json.courses)) {
  for (const p of c.prereqs || []) if (!json.courses[p]) unknown.add(`${code} -> ${p}`);
}
if (unknown.size) console.warn('Unknown prerequisite references:', [...unknown].join(', '));

const out =
  '/* GENERATED from src/data/curriculum.json by scripts/build-curriculum.mjs — do not edit by hand. */\n' +
  'window.GRADACUS_CURRICULUM = ' + JSON.stringify(json) + ';\n';
writeFileSync(resolve(root, 'curriculum-data.js'), out);
console.log(`curriculum-data.js written (${Object.keys(json.courses).length} courses, version ${json.version})`);
