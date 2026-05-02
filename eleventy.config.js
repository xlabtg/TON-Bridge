import { readFileSync, readdirSync } from 'fs';
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

export default function(eleventyConfig) {
  eleventyConfig.addGlobalData('locales', locales);

  // Shortcode that embeds all locale data inline so the runtime loader
  // doesn't need a fetch() (works with file:// and avoids CORS issues).
  eleventyConfig.addShortcode('i18nDataScript', function() {
    return `<script>window.__i18nData = ${JSON.stringify(locales)};</script>`;
  });

  eleventyConfig.addPassthroughCopy({ 'assets': 'assets' });
  eleventyConfig.addPassthroughCopy('__manifest.json');
  eleventyConfig.addPassthroughCopy('__service-worker.js');

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
