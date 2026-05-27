/**
 * Experiment: Investigate left-side menu issues from issue #170
 * 1. Does clicking the hamburger button scroll the page to the bottom?
 * 2. Is the sidebar displayed correctly on settings pages?
 * 3. Is the sidebar displayed correctly on all pages?
 */

import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'url';
import { resolve, dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function mockTelegramWebApp(page) {
  await page.route('https://telegram.org/js/telegram-web-app.js', route => route.fulfill({
    status: 200,
    contentType: 'application/javascript',
    body: '/* mocked */',
  }));
  await page.route('https://tganalytics.xyz/**', route => route.fulfill({
    status: 200,
    contentType: 'application/javascript',
    body: '/* analytics mocked */',
  }));
  await page.route('https://mc.yandex.ru/**', route => route.fulfill({
    status: 200,
    contentType: 'application/javascript',
    body: '/* metrika mocked */',
  }));
  await page.route('https://changenow.io/**', route => route.fulfill({
    status: 200,
    contentType: 'text/html',
    body: '<html><body>ChangeNOW</body></html>',
  }));

  await page.addInitScript(() => {
    localStorage.setItem('FinappConsent', JSON.stringify({
      version: 1,
      analytics: false,
      marketing: false,
      ts: Date.now(),
    }));

    window.Telegram = {
      WebApp: {
        ready() {},
        expand() {},
        onEvent() {},
        setHeaderColor() {},
        colorScheme: 'light',
        initDataUnsafe: { user: { id: 12345 } },
        MainButton: {
          setText() {}, show() {}, hide() {}, onClick() {}, offClick() {}, setParams() {},
          enable() {}, disable() {},
        },
        BackButton: { show() {}, hide() {}, onClick() {}, offClick() {} },
        SettingsButton: { show() {}, hide() {}, onClick() {}, offClick() {} },
        HapticFeedback: {
          notificationOccurred() {}, impactOccurred() {}, selectionChanged() {},
        },
      },
    };
  });
}

function distUrl(file) {
  return 'file://' + resolve(__dirname, '..', 'dist', file);
}

const PAGES = [
  { file: 'index.html', name: 'Bridge EN' },
  { file: 'index2.html', name: 'Exchange EN' },
  { file: 'index3.html', name: 'OTC EN' },
  { file: 'app-settings.html', name: 'Settings EN' },
  { file: 'referral.html', name: 'Referral EN' },
  { file: 'orders.html', name: 'Orders EN' },
  { file: 'redeem.html', name: 'Redeem EN' },
];

test.describe('Sidebar issue #170 investigation', () => {
  for (const { file, name } of PAGES) {
    test(`${name}: clicking menu button opens sidebar without scrolling page`, async ({ page }) => {
      await mockTelegramWebApp(page);
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(distUrl(file));
      
      // Record initial scroll position
      const initialScrollY = await page.evaluate(() => window.scrollY);
      console.log(`${name}: initial scrollY = ${initialScrollY}`);
      
      const menuButton = page.locator('[data-bs-target="#sidebarPanel"]');
      const hasMenuButton = await menuButton.count();
      
      if (!hasMenuButton) {
        console.log(`${name}: no menu button found - skipping`);
        return;
      }
      
      // Click the hamburger button
      await menuButton.click();
      
      // Wait a moment for any scroll to occur
      await page.waitForTimeout(500);
      
      // Check scroll position after click
      const afterScrollY = await page.evaluate(() => window.scrollY);
      console.log(`${name}: after click scrollY = ${afterScrollY}`);
      
      // The page should NOT scroll to the bottom
      expect(afterScrollY).toBeLessThanOrEqual(initialScrollY + 5, 
        `${name}: page scrolled after clicking menu button (was ${initialScrollY}, now ${afterScrollY})`);
    });
  }

  for (const { file, name } of PAGES) {
    test(`${name}: sidebar displays correctly with full content visible`, async ({ page }) => {
      await mockTelegramWebApp(page);
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(distUrl(file));
      
      const menuButton = page.locator('[data-bs-target="#sidebarPanel"]');
      const hasMenuButton = await menuButton.count();
      
      if (!hasMenuButton) {
        console.log(`${name}: no menu button found - skipping`);
        return;
      }
      
      // Open sidebar
      await menuButton.click();
      
      // Wait for sidebar to appear
      await expect(page.locator('#sidebarPanel')).toHaveClass(/show/, { timeout: 3000 });
      
      // Check sidebar is positioned correctly (should be visible on screen)
      const sidebarBounds = await page.locator('#sidebarPanel .modal-content').evaluate(el => {
        const rect = el.getBoundingClientRect();
        return {
          left: rect.left,
          right: rect.right,
          top: rect.top,
          bottom: rect.bottom,
          width: rect.width,
          height: rect.height,
        };
      });
      
      console.log(`${name}: sidebar bounds =`, JSON.stringify(sidebarBounds));
      
      // Sidebar should be on screen (left panel)
      expect(sidebarBounds.left).toBeGreaterThanOrEqual(0);
      expect(sidebarBounds.right).toBeLessThanOrEqual(390);
      expect(sidebarBounds.top).toBeGreaterThanOrEqual(0);
      
      // Sidebar should have reasonable dimensions
      expect(sidebarBounds.width).toBeGreaterThan(0);
      expect(sidebarBounds.height).toBeGreaterThan(0);
    });
  }
  
  for (const { file, name } of PAGES) {
    test(`${name}: sidebar support link is visible`, async ({ page }) => {
      await mockTelegramWebApp(page);
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(distUrl(file));
      
      const menuButton = page.locator('[data-bs-target="#sidebarPanel"]');
      const hasMenuButton = await menuButton.count();
      
      if (!hasMenuButton) {
        console.log(`${name}: no menu button found - skipping`);
        return;
      }
      
      // Open sidebar
      await menuButton.click();
      
      // Wait for sidebar to appear
      await expect(page.locator('#sidebarPanel')).toHaveClass(/show/, { timeout: 3000 });
      
      // Support link should be visible
      const supportLink = page.locator('#sidebarPanel #support-link');
      const hasSupportLink = await supportLink.count();
      
      if (hasSupportLink) {
        await expect(supportLink).toBeVisible();
        const linkBounds = await supportLink.evaluate(el => {
          const rect = el.getBoundingClientRect();
          return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
        });
        console.log(`${name}: support link bounds =`, JSON.stringify(linkBounds));
      } else {
        console.log(`${name}: WARNING - no support link found in sidebar!`);
      }
    });
  }
});
