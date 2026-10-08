// Worker configuration from environment variables (secrets come from Secret Manager mounted as
// env vars on Cloud Run; nothing secret is hard-coded).

export interface WorkerConfig {
  port: number;
  projectId: string | null;
  isCloudRun: boolean;
  appUrl: string | null;
  userAgent: string;
  agentToken: string;

  httpTimeoutMs: number;
  maxHtmlBytes: number;
  enableBrowser: boolean;
  browserTimeoutMs: number;
  chromiumPath: string | null;

  maxConcurrentChecks: number;
  perDomainConcurrency: number;
  domainMinSpacingMs: number;
  domainJitterMs: number;
  runBudgetMs: number;
  maxPerRun: number;
  maxPropertiesPerUser: number;

  adminEmails: string[];
  memberEmails: string[];
  tasksAuth: 'oidc' | 'none';
  /** Accepted OIDC audiences (Cloud Run URL forms). */
  tasksAudience: string[];
  schedulerServiceAccount: string | null;

  telegramBotToken: string | null;
  notifyDryRun: boolean;

  artifactBucket: string | null;
  screenshots: boolean;
  saveHtml: boolean;

  logChecks: 'all' | 'changes';
  logRetentionDays: number;
  logJson: boolean;

  mockFetchDir: string | null;
  devTickSeconds: number;
  corsOrigins: string[];
}

type Env = Record<string, string | undefined>;

const int = (v: string | undefined, d: number, min = 0, max = Number.MAX_SAFE_INTEGER) => {
  const n = v === undefined || v === '' ? d : Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : d;
};
const bool = (v: string | undefined, d: boolean) => (v === undefined || v === '' ? d : /^(1|true|yes|on)$/i.test(v));
const list = (v: string | undefined) =>
  (v ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

export function loadConfig(env: Env = process.env): WorkerConfig {
  const isCloudRun = !!env.K_SERVICE;
  const appUrl = env.APP_URL?.replace(/\/$/, '') || null;
  const agentToken = 'PropertyWatchBot';
  const cfg: WorkerConfig = {
    port: int(env.PORT, 8787, 1, 65535),
    projectId: env.GOOGLE_CLOUD_PROJECT || env.GCLOUD_PROJECT || env.FIREBASE_PROJECT_ID || null,
    isCloudRun,
    appUrl,
    userAgent: env.USER_AGENT || `${agentToken}/1.0 (+${appUrl ?? 'https://github.com/'}; personal property price monitor)`,
    agentToken,

    httpTimeoutMs: int(env.HTTP_TIMEOUT_MS, 20_000, 1000, 60_000),
    maxHtmlBytes: int(env.MAX_HTML_BYTES, 5 * 1024 * 1024, 100_000, 20 * 1024 * 1024),
    enableBrowser: bool(env.ENABLE_BROWSER, false),
    browserTimeoutMs: int(env.BROWSER_TIMEOUT_MS, 30_000, 5000, 90_000),
    chromiumPath: env.CHROMIUM_PATH || null,

    maxConcurrentChecks: int(env.MAX_CONCURRENT_CHECKS, 4, 1, 16),
    perDomainConcurrency: int(env.PER_DOMAIN_CONCURRENCY, 1, 1, 2),
    domainMinSpacingMs: int(env.DOMAIN_MIN_SPACING_MS, 2000, 1000, 60_000),
    domainJitterMs: int(env.DOMAIN_JITTER_MS, 1000, 0, 30_000),
    runBudgetMs: int(env.RUN_BUDGET_MS, 240_000, 10_000, 3_000_000),
    maxPerRun: int(env.MAX_PROPERTIES_PER_RUN, 300, 1, 2000),
    maxPropertiesPerUser: int(env.MAX_PROPERTIES_PER_USER, 500, 1, 5000),

    adminEmails: list(env.ADMIN_EMAILS),
    memberEmails: list(env.MEMBER_EMAILS),
    tasksAuth: env.TASKS_AUTH === 'none' ? 'none' : 'oidc',
    tasksAudience: (env.TASKS_AUDIENCE ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    schedulerServiceAccount: env.SCHEDULER_SA_EMAIL?.toLowerCase() || null,

    telegramBotToken: env.TELEGRAM_BOT_TOKEN?.trim() || null,
    notifyDryRun: bool(env.NOTIFY_DRY_RUN, false),

    artifactBucket: env.ARTIFACT_BUCKET || null,
    screenshots: bool(env.ENABLE_SCREENSHOTS, false),
    saveHtml: bool(env.SAVE_HTML_ON_CHANGE, false),

    logChecks: env.LOG_CHECKS === 'changes' ? 'changes' : 'all',
    logRetentionDays: int(env.LOG_RETENTION_DAYS, 14, 1, 365),
    logJson: bool(env.LOG_JSON, isCloudRun),

    mockFetchDir: env.MOCK_FETCH_DIR || null,
    devTickSeconds: int(env.DEV_TICK_SECONDS, 0, 0, 3600),
    corsOrigins: list(env.CORS_ORIGINS),
  };
  if (isCloudRun) {
    if (cfg.tasksAuth === 'none') throw new Error('TASKS_AUTH=none is not allowed on Cloud Run');
    if (cfg.tasksAudience.length === 0 || !cfg.schedulerServiceAccount) throw new Error('TASKS_AUDIENCE and SCHEDULER_SA_EMAIL are required on Cloud Run');
    if (cfg.mockFetchDir) throw new Error('MOCK_FETCH_DIR is for local development only');
    if (cfg.devTickSeconds) throw new Error('DEV_TICK_SECONDS is for local development only');
  }
  return cfg;
}

/** "a@x.jp" exact match, or "@x.jp" for a whole domain. */
export function emailListed(list: string[], email: string | null | undefined): boolean {
  if (!email) return false;
  const e = email.toLowerCase();
  return list.some((x) => (x.startsWith('@') ? e.endsWith(x) : e === x));
}
