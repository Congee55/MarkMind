import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const read = file => readFileSync(join(root, file), 'utf8');
const manifest = JSON.parse(read('manifest.json'));
const pkg = JSON.parse(read('package.json'));
if (manifest.manifest_version !== 3) throw Error('Expected Manifest V3');
if (manifest.version !== pkg.version) throw Error('Version mismatch between manifest and package.json');
if (manifest.background?.service_worker !== 'background.js') throw Error('Missing service worker');
for (const file of ['popup.html', 'popup.css', 'background.js', 'engine.js', 'ai-client.js']) {
  if (!existsSync(join(root, file))) throw Error(`Missing required file: ${file}`);
}
const html = read('popup.html');
for (const [, file] of html.matchAll(/<script\s+src=["']([^"']+)["']/g)) {
  if (!existsSync(join(root, file))) throw Error(`Missing script in popup.html: ${file}`);
}
for (const file of readdirSync(root).filter(f => f.endsWith('.js'))) {
  execFileSync(process.execPath, ['--check', join(root, file)], { stdio: 'pipe' });
}
for (const size of ['16', '48', '128']) {
  if (!existsSync(join(root, `icons/icon${size}.png`))) throw Error(`Missing icon ${size}px`);
}
for (const permission of ['bookmarks', 'storage']) {
  if (!manifest.permissions.includes(permission)) throw Error(`Missing permission: ${permission}`);
}
console.log(`Extension manifest and scripts OK (v${manifest.version}).`);
