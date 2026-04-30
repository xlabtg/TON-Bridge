import { readFileSync } from 'fs';
import { execSync } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const en = JSON.parse(readFileSync(join(__dirname, 'src/i18n/en.json'), 'utf8'));
const ru = JSON.parse(readFileSync(join(__dirname, 'src/i18n/ru.json'), 'utf8'));

function getBuildSha() {
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
  } catch {
    return 'latest';
  }
}

const baseUrl = process.env.BASE_URL || 'https://tonbankcard.com/bridge/TMA/00.html';
const buildSha = process.env.BUILD_SHA || getBuildSha();

export default function(eleventyConfig) {
  eleventyConfig.addGlobalData('locales', { en, ru });
  eleventyConfig.addGlobalData('baseUrl', baseUrl);
  eleventyConfig.addGlobalData('buildSha', buildSha);

  eleventyConfig.addPassthroughCopy({ 'assets': 'assets' });
  eleventyConfig.addPassthroughCopy('__manifest.json');
  eleventyConfig.addPassthroughCopy('__service-worker.js');
  eleventyConfig.addPassthroughCopy('robots.txt');

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
