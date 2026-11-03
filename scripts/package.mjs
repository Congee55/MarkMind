import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const version = JSON.parse(readFileSync(join(root,'manifest.json'),'utf8')).version;
const outDir = join(root, 'dist');
mkdirSync(outDir, { recursive: true });
const entries = readdirSync(root).filter(name => /^(?:.*\.js|popup\.html|popup\.css|manifest\.json|icons)$/.test(name));
const archive = join(outDir, `markmind-${version}.zip`);
// Uses the system ZIP utility on macOS/Linux; the repository can also be loaded unpacked.
try {
  execFileSync('zip', ['-q','-r',archive,...entries], {cwd:root,stdio:'pipe'});
} catch(error) {
  throw Error('Packaging needs the zip command (macOS/Linux). The unpacked extension remains installable.');
}
console.log(`Created ${archive}`);
