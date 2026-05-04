// Injects the current git SHA into __service-worker.js as SW_VERSION.
// Run via: node build-sw.js
// The script reads __service-worker.js, replaces the placeholder, and writes
// the result to the dist/ directory so the source file stays clean.
import { execSync } from 'child_process';
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'fs';
import { join, dirname, relative, sep } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const distDir = join(__dirname, 'dist');

let gitSha;
try {
  gitSha = execSync('git rev-parse --short HEAD', { cwd: __dirname }).toString().trim();
} catch {
  gitSha = Date.now().toString(36);
}

function walk(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const fullPath = join(dir, entry);
    return statSync(fullPath).isDirectory() ? walk(fullPath) : [fullPath];
  });
}

function toUrlPath(filePath) {
  return relative(distDir, filePath).split(sep).join('/');
}

function shouldPrecache(url) {
  if (url === '__service-worker.js') return false;
  if (url === '__manifest.json') return true;
  return (
    url.endsWith('.html') ||
    url.startsWith('assets/css/') && url.endsWith('.css') ||
    url.startsWith('assets/js/') && url.endsWith('.js') ||
    url.startsWith('assets/img/') && /\.(png|jpe?g|svg|webp|ico)$/i.test(url) ||
    url.startsWith('assets/fonts/') && /\.(woff2?|ttf|otf)$/i.test(url)
  );
}

function replaceRequired(source, target, replacement) {
  if (!source.includes(target)) {
    throw new Error(`Service worker template is missing expected marker: ${target}`);
  }
  return source.replace(target, replacement);
}

mkdirSync(distDir, { recursive: true });
const precacheUrls = walk(distDir)
  .map(toUrlPath)
  .filter(shouldPrecache)
  .sort();

const src = readFileSync(join(__dirname, '__service-worker.js'), 'utf8');
let versioned = replaceRequired(
  src,
  "var SW_VERSION = self.__SW_VERSION || 'dev';",
  `var SW_VERSION = '${gitSha}';`
);
versioned = replaceRequired(
  versioned,
  'var PRECACHE_URLS = self.__PRECACHE_URLS || [];',
  `var PRECACHE_URLS = ${JSON.stringify(precacheUrls, null, 2)};`
);

writeFileSync(join(distDir, '__service-worker.js'), versioned, 'utf8');
console.log(`Service worker written to dist/__service-worker.js (version: ${gitSha}, precache: ${precacheUrls.length} files)`);
