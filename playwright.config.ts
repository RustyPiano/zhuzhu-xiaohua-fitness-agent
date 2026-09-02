import { defineConfig, devices } from '@playwright/test';
import bundledChromium from '@sparticuz/chromium';
import { mkdir, stat, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const useBundledChromium = process.env.USE_BUNDLED_CHROMIUM === 'true';
async function prepareBundledChromium() {
  if (!useBundledChromium) return undefined;
  await mkdir(join(tmpdir(), 'fonts'), { recursive: true });
  const cachedExecutable = join(tmpdir(), 'chromium');
  try {
    if ((await stat(cachedExecutable)).size === 0) await unlink(cachedExecutable);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  return {
    args: bundledChromium.args.filter((argument) => !['--single-process', '--no-zygote'].includes(argument)),
    executablePath: await bundledChromium.executablePath(),
    headless: true,
  };
}
const bundledLaunchOptions = await prepareBundledChromium();

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 40_000,
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:8789',
    trace: 'retain-on-failure',
    launchOptions: bundledLaunchOptions,
  },
  webServer: {
    command: 'pnpm build && NODE_ENV=development DEV_AUTH=true DEV_FIXTURES=true DEV_MOCK_AGENT=true PORT=8789 APP_ORIGIN=http://127.0.0.1:8789 RUNTIME_DIR=.local/e2e-runtime DATA_REPO=.local/e2e-data UPLOADS_DIR=.local/e2e-uploads RELEASES_DIR=.local/e2e-releases node dist/server/index.js',
    url: 'http://127.0.0.1:8789/api/health', reuseExistingServer: false, timeout: 120_000,
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 960 } } },
    { name: 'mobile', use: { ...devices['iPhone 13'], browserName: 'chromium' } },
  ],
});
