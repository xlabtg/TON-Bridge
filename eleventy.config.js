import { existsSync, readFileSync, readdirSync } from 'fs';
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

export default function(eleventyConfig) {
  eleventyConfig.addGlobalData('locales', locales);
  eleventyConfig.addGlobalData('criticalCss', criticalCss);

  // Shortcode that embeds all locale data inline so the runtime loader
  // doesn't need a fetch() (works with file:// and avoids CORS issues).
  eleventyConfig.addShortcode('i18nDataScript', function() {
    return `<script>window.__i18nData = ${JSON.stringify(locales)};</script>`;
  });

  eleventyConfig.addPassthroughCopy({ 'assets': 'assets' });
  eleventyConfig.addPassthroughCopy({
    'node_modules/@tonconnect/ui/dist/tonconnect-ui.min.js': 'assets/js/vendor/tonconnect-ui.min.js'
  });
  eleventyConfig.addPassthroughCopy('__manifest.json');
  eleventyConfig.addPassthroughCopy('__service-worker.js');
  eleventyConfig.addPassthroughCopy('tonconnect-manifest.json');

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
