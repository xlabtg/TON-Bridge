import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'url';
import { existsSync, readFileSync } from 'fs';
import { resolve, dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

function distPath(file) {
  return resolve(__dirname, '..', 'dist', file);
}

function distHtml(file) {
  return readFileSync(distPath(file), 'utf8');
}

function withoutScripts(html) {
  return html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
}

async function waitForDistFile(file) {
  await expect.poll(() => existsSync(distPath(file)), { timeout: 30000 }).toBe(true);
}

test.describe('Russian generated HTML', () => {
  test('renders Russian text before runtime i18n applies', async () => {
    await Promise.all([
      waitForDistFile('index-ru.html'),
      waitForDistFile('index2-ru.html'),
      waitForDistFile('app-settings-ru.html'),
    ]);

    const bridge = withoutScripts(distHtml('index-ru.html'));
    const exchange = withoutScripts(distHtml('index2-ru.html'));
    const settings = withoutScripts(distHtml('app-settings-ru.html'));

    expect(bridge).toContain('<html lang="ru"');
    expect(bridge).toContain('Подключить кошелёк');
    expect(bridge).toContain('Группа в Telegram');
    expect(bridge).toContain('Чат в Telegram');

    expect(exchange).toContain('Открыть обмен');
    expect(exchange).toContain('Группа в Telegram');
    expect(exchange).toContain('Чат в Telegram');

    expect(settings).toContain('<html lang="ru"');
    expect(settings).toContain('Настройки');
    expect(settings).toContain('Темный режим');
    expect(settings).toContain('Язык (RU/EN)');

    for (const html of [bridge, exchange, settings]) {
      expect(html).not.toContain('Connect wallet');
      expect(html).not.toContain('Open exchange');
      expect(html).not.toContain('Telegram Group');
      expect(html).not.toContain('Telegram Chat');
      expect(html).not.toContain('Dark Mode');
      expect(html).not.toContain('Language (EN/RU)');
    }
  });
});
