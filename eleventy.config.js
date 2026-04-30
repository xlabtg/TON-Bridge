import { readFileSync, writeFileSync, mkdirSync } from 'fs';
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

  // After the build, overwrite the passthrough-copied sentry.js with a version
  // that has Sentry env vars injected from the build environment.
  eleventyConfig.on('eleventy.after', ({ dir }) => {
    const src = readFileSync(join(__dirname, 'assets/js/sentry.js'), 'utf8');
    const out = src
      .replace('__SENTRY_DSN__', process.env.SENTRY_DSN || '')
      .replace('__SENTRY_RELEASE__', process.env.SENTRY_RELEASE || process.env.GITHUB_SHA || '')
      .replace('__SENTRY_ENVIRONMENT__', process.env.SENTRY_ENVIRONMENT || 'production')
      .replace('__SENTRY_TRACES_SAMPLE_RATE__', process.env.SENTRY_TRACES_SAMPLE_RATE || '0.1');
    const destDir = join(__dirname, dir.output, 'assets', 'js');
    mkdirSync(destDir, { recursive: true });
    writeFileSync(join(destDir, 'sentry.js'), out);
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
