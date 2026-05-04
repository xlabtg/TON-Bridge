import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..', '..');

const REQUIRED = [
  'TG_ANALYTICS_TOKEN',
  'TG_ANALYTICS_APP_NAME',
  'YANDEX_METRIKA_ID',
  'CHANGENOW_LINK_ID',
  'BOT_USERNAME',
];

export default function () {
  const envPath = join(rootDir, '.env');
  if (existsSync(envPath)) {
    const lines = readFileSync(envPath, 'utf8').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      const val = trimmed.slice(eq + 1).trim().replace(/^['"]|['"]$/g, '');
      if (!(key in process.env)) process.env[key] = val;
    }
  }

  const missing = REQUIRED.filter(k => !process.env[k]);
  if (missing.length) {
    throw new Error(
      `Missing required environment variables:\n  ${missing.join('\n  ')}\n\nCopy .env.example to .env and fill in real values.`
    );
  }

  return {
    TG_ANALYTICS_TOKEN: process.env.TG_ANALYTICS_TOKEN,
    TG_ANALYTICS_APP_NAME: process.env.TG_ANALYTICS_APP_NAME,
    YANDEX_METRIKA_ID: process.env.YANDEX_METRIKA_ID,
    CHANGENOW_LINK_ID: process.env.CHANGENOW_LINK_ID,
    BOT_USERNAME: process.env.BOT_USERNAME,
  };
}
