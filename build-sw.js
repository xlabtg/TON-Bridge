// Injects the current git SHA into __service-worker.js as SW_VERSION.
// Run via: node build-sw.js
// The script reads __service-worker.js, replaces the placeholder, and writes
// the result to the dist/ directory so the source file stays clean.
import { execSync } from 'child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

let gitSha;
try {
  gitSha = execSync('git rev-parse --short HEAD', { cwd: __dirname }).toString().trim();
} catch {
  gitSha = Date.now().toString(36);
}

const src = readFileSync(join(__dirname, '__service-worker.js'), 'utf8');
const versioned = src.replace(
  "var SW_VERSION = self.__SW_VERSION || 'dev';",
  `var SW_VERSION = '${gitSha}';`
);

const distDir = join(__dirname, 'dist');
mkdirSync(distDir, { recursive: true });
writeFileSync(join(distDir, '__service-worker.js'), versioned, 'utf8');
console.log(`Service worker written to dist/__service-worker.js (version: ${gitSha})`);
