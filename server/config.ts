import path from 'node:path';

const cwd = process.cwd();
const local = path.join(cwd, '.local');
const number = (name: string, fallback: number) => {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(value)) throw new Error(`${name} 必须是有限数值`);
  return value;
};

export const config = {
  port: number('PORT', 8787),
  timezone: process.env.APP_TIMEZONE ?? 'Asia/Shanghai',
  origin: process.env.APP_ORIGIN ?? 'http://127.0.0.1:8787',
  previewOrigin: process.env.PREVIEW_ORIGIN ?? 'http://127.0.0.1:4173',
  dataRepo: path.resolve(process.env.DATA_REPO ?? path.join(local, 'data-repo')),
  runtimeDir: path.resolve(process.env.RUNTIME_DIR ?? path.join(local, 'runtime')),
  uploadsDir: path.resolve(process.env.UPLOADS_DIR ?? path.join(local, 'uploads')),
  releasesDir: path.resolve(process.env.RELEASES_DIR ?? path.join(local, 'releases')),
  appRepo: path.resolve(process.env.APP_REPO ?? cwd),
  webWarnMicrousd: Math.round(number('WEB_WARN_USD', 8) * 1_000_000),
  webStopMicrousd: Math.round(number('WEB_STOP_USD', 9) * 1_000_000),
  exaKey: process.env.EXA_API_KEY ?? null,
  modelProvider: process.env.MODEL_PROVIDER ?? null,
  modelId: process.env.MODEL_ID ?? null,
  modelKey: process.env.MODEL_API_KEY ?? null,
  agentSandboxImage: process.env.AGENT_SANDBOX_IMAGE ?? process.env.UI_SANDBOX_IMAGE ?? null,
  uiSandboxImage: process.env.UI_SANDBOX_IMAGE ?? null,
  devAuth: process.env.NODE_ENV !== 'production' && process.env.DEV_AUTH === 'true',
  devFixtures: process.env.NODE_ENV !== 'production' && process.env.DEV_FIXTURES === 'true',
};

if (config.webWarnMicrousd >= config.webStopMicrousd) throw new Error('WEB_WARN_USD 必须小于 WEB_STOP_USD');

export function businessDate(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: config.timezone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
}

export function businessMonth(now = new Date()): string {
  return businessDate(now).slice(0, 7);
}
