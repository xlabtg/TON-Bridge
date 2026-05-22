import { execSync } from 'child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const i18nDir = join(__dirname, 'src/i18n');

function loadLocales() {
  return readdirSync(i18nDir)
    .filter(file => file.endsWith('.json'))
    .sort()
    .reduce((locales, file) => {
      const code = file.slice(0, -'.json'.length);
      locales[code] = JSON.parse(readFileSync(join(i18nDir, file), 'utf8'));
      return locales;
    }, {});
}

const locales = loadLocales();

const criticalCssPath = join(__dirname, 'assets/css/critical.css');
const criticalCss = existsSync(criticalCssPath)
  ? readFileSync(criticalCssPath, 'utf8').replace(/\/\*#\s*sourceMappingURL=[^\*]*\*\//g, '').trim()
  : '';

function getBuildSha() {
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
  } catch {
    return 'latest';
  }
}

const baseUrl = process.env.BASE_URL || 'https://tonbankcard.com/bridge/TMA/00.html';
const buildSha = process.env.BUILD_SHA || getBuildSha();

function jsStringValue(value) {
  return JSON.stringify(String(value ?? ''));
}

function injectPlaceholders(source, replacements) {
  return Object.entries(replacements).reduce(
    (out, [placeholder, value]) => out.split(placeholder).join(value),
    source
  );
}

export default function(eleventyConfig) {
  eleventyConfig.addGlobalData('locales', locales);
  eleventyConfig.addGlobalData('criticalCss', criticalCss);
  eleventyConfig.addGlobalData('baseUrl', baseUrl);
  eleventyConfig.addGlobalData('buildSha', buildSha);
  eleventyConfig.addGlobalData('ADMIN_TELEGRAM_IDS', process.env.ADMIN_TELEGRAM_IDS || '__ADMIN_TELEGRAM_IDS__');
  eleventyConfig.addGlobalData('ADMIN_API_BASE', process.env.ADMIN_API_BASE || '');
  eleventyConfig.addFilter('jsString', jsStringValue);

  // Shortcode that embeds all locale data inline so the runtime loader
  // doesn't need a fetch() (works with file:// and avoids CORS issues).
  eleventyConfig.addShortcode('i18nDataScript', function() {
    return `<script>window.__i18nData = ${JSON.stringify(locales)};</script>`;
  });

  eleventyConfig.addPassthroughCopy({ 'assets': 'assets' });
  if (!existsSync(join(__dirname, 'assets/js/vendor/tonconnect-ui.min.js'))) {
    eleventyConfig.addPassthroughCopy({
      'node_modules/@tonconnect/ui/dist/tonconnect-ui.min.js': 'assets/js/vendor/tonconnect-ui.min.js'
    });
  }
  // Self-host Chart.js (issue #119) so statistics-page.njk no longer relies on a
  // CDN script tag without SRI; the file is precached by build-sw.js because it
  // lands under assets/js/.
  eleventyConfig.addPassthroughCopy({
    'node_modules/chart.js/dist/chart.umd.min.js': 'assets/js/lib/chart.umd.min.js'
  });
  eleventyConfig.addPassthroughCopy('__manifest.json');
  eleventyConfig.addPassthroughCopy('__service-worker.js');
  eleventyConfig.addPassthroughCopy('.htaccess');
  eleventyConfig.addPassthroughCopy('config');
  eleventyConfig.addPassthroughCopy('installer');
  eleventyConfig.addPassthroughCopy('humans.txt');
  eleventyConfig.addPassthroughCopy('robots.txt');
  eleventyConfig.addPassthroughCopy('tonconnect-manifest.json');

  // After the build, overwrite passthrough-copied runtime assets with versions
  // that have environment-specific public configuration injected.
  eleventyConfig.on('eleventy.after', ({ dir }) => {
    const destDir = join(__dirname, dir.output, 'assets', 'js');
    mkdirSync(destDir, { recursive: true });

    const sentrySrc = readFileSync(join(__dirname, 'assets/js/sentry.js'), 'utf8');
    const sentryOut = sentrySrc
      .replace('__SENTRY_DSN__', process.env.SENTRY_DSN || '')
      .replace('__SENTRY_RELEASE__', process.env.SENTRY_RELEASE || process.env.GITHUB_SHA || '')
      .replace('__SENTRY_ENVIRONMENT__', process.env.SENTRY_ENVIRONMENT || 'production')
      .replace('__SENTRY_TRACES_SAMPLE_RATE__', process.env.SENTRY_TRACES_SAMPLE_RATE || '0.1');
    writeFileSync(join(destDir, 'sentry.js'), sentryOut);

    const baseSrc = readFileSync(join(__dirname, 'assets/js/base.js'), 'utf8');
    const baseOut = injectPlaceholders(baseSrc, {
      "'%%TG_ANALYTICS_TOKEN%%'": jsStringValue(process.env.TG_ANALYTICS_TOKEN || ''),
      "'%%TG_ANALYTICS_APP_NAME%%'": jsStringValue(process.env.TG_ANALYTICS_APP_NAME || ''),
      "'%%YANDEX_METRIKA_ID%%'": jsStringValue(process.env.YANDEX_METRIKA_ID || ''),
    });
    writeFileSync(join(destDir, 'base.js'), baseOut);
  });

  return {
    dir: {
      input: 'src',
      output: 'dist',
      includes: '_includes',
      data: '_data',
    },
    htmlTemplateEngine: 'njk',
    markdownTemplateEngine: 'njk',
  };
}
