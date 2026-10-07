// Cloud Run entry point.

import path from 'node:path';
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { EmailChannel, TelegramChannel, TelegramClient, createEmailProvider } from '@gsb/notifications';
import { createDefaultRegistry } from '@gsb/parser';
import { GcsArtifactStore, type ArtifactStore } from './artifacts';
import { loadConfig } from './config';
import type { EngineDeps } from './engine/check';
import { Notifier } from './engine/notify';
import { runDue } from './engine/runner';
import { createMockFetcher, createNetworkFetcher } from './fetch';
import { BrowserFetcher } from './fetch/browser';
import { MockSites } from './fetch/mock';
import { buildRoutes } from './http/api';
import { TaskAuth, verifyUser } from './http/auth';
import { createServer } from './http/server';
import { createLogger } from './log';
import { HostLimiter } from './rate-limit';
import { FirestoreStore } from './store/firestore';

const cfg = loadConfig();
const log = createLogger(cfg.logJson, process.env.LOG_LEVEL === 'debug' ? 'debug' : 'info');

const app = initializeApp(cfg.projectId ? { projectId: cfg.projectId } : undefined);
const db = getFirestore(app);
db.settings({ ignoreUndefinedProperties: true });
const auth = getAuth(app);
const store = new FirestoreStore(db);
const now = () => Date.now();
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const browser = cfg.enableBrowser
  ? new BrowserFetcher({ userAgent: cfg.userAgent, timeoutMs: cfg.browserTimeoutMs, maxBytes: cfg.maxHtmlBytes, executablePath: cfg.chromiumPath ?? undefined })
  : null;
const mock = cfg.mockFetchDir ? new MockSites(path.resolve(cfg.mockFetchDir)) : null;
const fetcher = mock
  ? createMockFetcher(mock)
  : createNetworkFetcher({
      userAgent: cfg.userAgent,
      agentToken: cfg.agentToken,
      httpTimeoutMs: cfg.httpTimeoutMs,
      maxBytes: cfg.maxHtmlBytes,
      browser,
      now,
      loadRobots: async (host) => (await store.getDomainState(host))?.robots ?? null,
      saveRobots: (host, robots) => store.setDomainState(host, { robots }),
    });

let artifacts: ArtifactStore | null = null;
if (cfg.artifactBucket) {
  const { getStorage } = await import('firebase-admin/storage');
  artifacts = new GcsArtifactStore(getStorage(app).bucket(cfg.artifactBucket));
}

const notifier = new Notifier({
  store,
  channels: {
    TELEGRAM: new TelegramChannel(cfg.telegramBotToken ? new TelegramClient({ botToken: cfg.telegramBotToken }) : null),
    EMAIL: new EmailChannel(createEmailProvider(process.env)),
  },
  dryRun: cfg.notifyDryRun,
  appUrl: cfg.appUrl,
  now,
  logRetentionDays: cfg.logRetentionDays,
  log,
});

const engine: EngineDeps = {
  store,
  fetcher,
  registry: createDefaultRegistry(),
  limiter: new HostLimiter({
    global: cfg.maxConcurrentChecks,
    perHost: cfg.perDomainConcurrency,
    minSpacingMs: cfg.domainMinSpacingMs,
    jitterMs: cfg.domainJitterMs,
  }),
  notifier,
  artifacts,
  log,
  config: { logChecks: cfg.logChecks, logRetentionDays: cfg.logRetentionDays, screenshots: cfg.screenshots, saveHtml: cfg.saveHtml },
  now,
  sleep,
};

const runner = {
  budgetMs: cfg.runBudgetMs,
  maxPerRun: cfg.maxPerRun,
  lockTtlMs: cfg.runBudgetMs + 120_000,
  minSpacingMs: cfg.domainMinSpacingMs,
  jitterMs: cfg.domainJitterMs,
};

const taskAuth = new TaskAuth({ mode: cfg.tasksAuth, audience: cfg.tasksAudience, serviceAccount: cfg.schedulerServiceAccount });
const server = createServer({
  routes: buildRoutes({
    cfg,
    engine,
    store,
    runner,
    artifacts,
    mock,
    now,
    setRole: async (uid, claims, role) => {
      const { role: _old, ...rest } = claims;
      const keep = Object.fromEntries(
        Object.entries(rest).filter(([k]) => !['iss', 'aud', 'auth_time', 'user_id', 'sub', 'iat', 'exp', 'email', 'email_verified', 'firebase', 'uid', 'name', 'picture'].includes(k)),
      );
      await auth.setCustomUserClaims(uid, role ? { ...keep, role } : keep);
    },
  }),
  verifyUser: (h) => verifyUser(auth, h),
  verifyTask: (h) => taskAuth.verify(h),
  devMode: !cfg.isCloudRun && !!mock,
  corsOrigins: cfg.corsOrigins,
  log,
});

server.listen(cfg.port, () => {
  log.info('worker listening', {
    port: cfg.port,
    fetcher: fetcher.kind,
    browser: !!browser,
    telegram: notifier.isConfigured('TELEGRAM'),
    email: notifier.isConfigured('EMAIL'),
    dryRun: cfg.notifyDryRun,
    tasksAuth: cfg.tasksAuth,
  });
});

let tick: NodeJS.Timeout | null = null;
if (cfg.devTickSeconds > 0) {
  // Local stand-in for Cloud Scheduler.
  tick = setInterval(() => {
    runDue(engine, runner).catch((e: Error) => log.error('dev tick failed', { error: e.message }));
  }, cfg.devTickSeconds * 1000);
}

const shutdown = async () => {
  log.info('shutting down');
  if (tick) clearInterval(tick);
  server.close();
  await browser?.close();
  process.exit(0);
};
process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());
