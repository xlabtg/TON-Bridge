import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 30000,
  // After moving page scripts to `defer`, file:// loads can occasionally
  // observe a race where `page.goto`'s load event fires before all defer
  // scripts publish their globals (`window.Achievements`, `window.TonBridgeAuth`,
  // etc.). Tests now wait for those explicitly, but keep one CI retry as a
  // safety net for any remaining timing flake.
  retries: process.env.CI ? 1 : 0,
  webServer: {
    command: 'npm run build',
    stdout: 'pipe',
    stderr: 'pipe',
  },
  use: {
    headless: true,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
