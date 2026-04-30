import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const en = JSON.parse(readFileSync(join(__dirname, 'src/i18n/en.json'), 'utf8'));
const ru = JSON.parse(readFileSync(join(__dirname, 'src/i18n/ru.json'), 'utf8'));

export default function(eleventyConfig) {
  eleventyConfig.addGlobalData('locales', { en, ru });

  // Shortcode that embeds all locale data inline so the runtime loader
  // doesn't need a fetch() (works with file:// and avoids CORS issues).
  eleventyConfig.addShortcode('i18nDataScript', function() {
    return `<script>window.__i18nData = ${JSON.stringify({ en, ru })};</script>`;
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
