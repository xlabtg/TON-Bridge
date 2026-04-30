import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const en = JSON.parse(readFileSync(join(__dirname, 'src/i18n/en.json'), 'utf8'));
const ru = JSON.parse(readFileSync(join(__dirname, 'src/i18n/ru.json'), 'utf8'));

const criticalCssPath = join(__dirname, 'assets/css/critical.css');
const criticalCss = existsSync(criticalCssPath)
  ? readFileSync(criticalCssPath, 'utf8').replace(/\/\*#\s*sourceMappingURL=[^\*]*\*\//g, '').trim()
  : '';

export default function(eleventyConfig) {
  eleventyConfig.addGlobalData('locales', { en, ru });
  eleventyConfig.addGlobalData('criticalCss', criticalCss);

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
