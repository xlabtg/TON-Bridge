import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const en = JSON.parse(readFileSync(join(__dirname, 'src/i18n/en.json'), 'utf8'));
const ru = JSON.parse(readFileSync(join(__dirname, 'src/i18n/ru.json'), 'utf8'));

export default function(eleventyConfig) {
  eleventyConfig.addGlobalData('locales', { en, ru });

  eleventyConfig.addPassthroughCopy({ 'assets': 'assets' });
  eleventyConfig.addPassthroughCopy('__manifest.json');
  eleventyConfig.addPassthroughCopy('__service-worker.js');
  eleventyConfig.addPassthroughCopy('humans.txt');

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
