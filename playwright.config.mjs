// Browser tests run against the built site (_site/) served under a
// sub-path, exactly like a GitHub Pages project site.
import { defineConfig, devices } from '@playwright/test';

const PORT = 4183;
// WebKit needs extra system libraries; CI installs them with --with-deps.
const WEBKIT = !!(process.env.CI || process.env.WEBKIT);

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 120_000,
  retries: process.env.CI ? 1 : 0,
  fullyParallel: true,
  workers: process.env.CI ? 2 : 4,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}/lantern-wheel/`,
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `node tools/build.mjs && node tools/serve.mjs ${PORT} _site /lantern-wheel/`,
    url: `http://localhost:${PORT}/lantern-wheel/`,
    reuseExistingServer: !process.env.CI,
  },
  projects: [
    { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile-chromium', use: { ...devices['Pixel 7'] } },
    { name: 'desktop-firefox', use: { ...devices['Desktop Firefox'] } },
    ...(WEBKIT ? [{ name: 'mobile-webkit', use: { ...devices['iPhone 13'] } }] : []),
  ],
});
