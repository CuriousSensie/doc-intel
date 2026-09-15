import { z } from "zod";

const emailProviderSchema = z.enum(["console", "smtp"]);

export const envSchema = z.object({
  NEXT_PUBLIC_APP_URL: z.string().url().default("http://localhost:3000"),
  NEXT_PUBLIC_APP_NAME: z.string().min(1).default("MVP Boilerplate"),
  SUPPORT_EMAIL: z.string().email().default("support@example.com"),
  NEXT_PUBLIC_SUPABASE_URL: z.string().url().optional().or(z.literal("")),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_PRICE_PRO_MONTHLY: z.string().optional(),
  STRIPE_PRICE_PRO_YEARLY: z.string().optional(),
  STRIPE_PRICE_TEAM_MONTHLY: z.string().optional(),
  STRIPE_PRICE_TEAM_YEARLY: z.string().optional(),
  STRIPE_PRICE_CREDITS_STARTER: z.string().optional(),
  STRIPE_PRICE_CREDITS_GROWTH: z.string().optional(),
  STRIPE_PRICE_CREDITS_SCALE: z.string().optional(),
  EMAIL_PROVIDER: emailProviderSchema.default("console"),
  EMAIL_FROM: z.string().min(1).default("MVP Boilerplate <no-reply@example.com>"),
  EMAIL_DEV_RECIPIENT: z.string().email().optional().or(z.literal("")),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().optional(),
  SMTP_SECURE: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  RATE_LIMIT_MODE: z.enum(["memory", "external"]).default("memory"),
  // Separate Redis instance from Paperless's, so an import backlog never starves our own jobs.
  REDIS_URL: z.string().url().default("redis://localhost:6379"),
  WORKER_INGEST_CONCURRENCY: z.coerce.number().int().positive().default(8),
  PAPERLESS_INGEST_RATE_PER_SECOND: z.coerce.number().int().positive().default(4),
  PAPERLESS_UPLOADS_PER_ORG_PER_MINUTE: z.coerce.number().int().positive().default(120),
  PAPERLESS_READS_PER_ORG_PER_MINUTE: z.coerce.number().int().positive().default(600),
  PAPERLESS_HTTP_CONNECTIONS: z.coerce.number().int().positive().default(16),
  PAPERLESS_STREAM_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
  // Superuser creds, provisioning only (paperlessAdminClient(), ESLint-restricted).
  PAPERLESS_ADMIN_URL: z.string().url().optional(),
  PAPERLESS_ADMIN_USER: z.string().optional(),
  PAPERLESS_ADMIN_PASSWORD: z.string().optional(),
  // base64, 32 bytes decoded. Generate with: openssl rand -base64 32
  PAPERLESS_TOKEN_ENCRYPTION_KEY: z.string().optional(),
  // validate-upload.ts's AV scan (specs/10-nonfunctional.md §Security). clamd's INSTREAM port.
  CLAMAV_HOST: z.string().default("localhost"),
  CLAMAV_PORT: z.coerce.number().int().positive().default(3310),
  // Shared with infra/scripts/notify-pomocnik.sh (Paperless container's env) — signs the
  // post-consume webhook's body+timestamp. /api/internal/paperless/document-consumed.
  POMOCNIK_WEBHOOK_SECRET: z.string().optional()
});

export type AppEnv = z.infer<typeof envSchema>;

// Next.js only inlines `NEXT_PUBLIC_*` vars into the client bundle when they appear as a
// literal `process.env.NEXT_PUBLIC_X` member expression — passing the whole `process.env`
// object by reference (the previous default parameter here) is invisible to that static
// replacement, so every NEXT_PUBLIC_ var silently came back `undefined` in any client
// component. Found live: `src/lib/supabase/client.ts`'s `createClient()` (the browser Supabase
// client) had never actually been exercised in a browser until
// `document-upload-form.tsx` — first real caller, first time this broke visibly. Every key is
// listed explicitly so each one is its own static `process.env.KEY` expression.
function readProcessEnv(): Record<string, string | undefined> {
  return {
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    NEXT_PUBLIC_APP_NAME: process.env.NEXT_PUBLIC_APP_NAME,
    SUPPORT_EMAIL: process.env.SUPPORT_EMAIL,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
    STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,
    STRIPE_PRICE_PRO_MONTHLY: process.env.STRIPE_PRICE_PRO_MONTHLY,
    STRIPE_PRICE_PRO_YEARLY: process.env.STRIPE_PRICE_PRO_YEARLY,
    STRIPE_PRICE_TEAM_MONTHLY: process.env.STRIPE_PRICE_TEAM_MONTHLY,
    STRIPE_PRICE_TEAM_YEARLY: process.env.STRIPE_PRICE_TEAM_YEARLY,
    STRIPE_PRICE_CREDITS_STARTER: process.env.STRIPE_PRICE_CREDITS_STARTER,
    STRIPE_PRICE_CREDITS_GROWTH: process.env.STRIPE_PRICE_CREDITS_GROWTH,
    STRIPE_PRICE_CREDITS_SCALE: process.env.STRIPE_PRICE_CREDITS_SCALE,
    EMAIL_PROVIDER: process.env.EMAIL_PROVIDER,
    EMAIL_FROM: process.env.EMAIL_FROM,
    EMAIL_DEV_RECIPIENT: process.env.EMAIL_DEV_RECIPIENT,
    SMTP_HOST: process.env.SMTP_HOST,
    SMTP_PORT: process.env.SMTP_PORT,
    SMTP_SECURE: process.env.SMTP_SECURE,
    SMTP_USER: process.env.SMTP_USER,
    SMTP_PASSWORD: process.env.SMTP_PASSWORD,
    RATE_LIMIT_MODE: process.env.RATE_LIMIT_MODE,
    REDIS_URL: process.env.REDIS_URL,
    WORKER_INGEST_CONCURRENCY: process.env.WORKER_INGEST_CONCURRENCY,
    PAPERLESS_INGEST_RATE_PER_SECOND: process.env.PAPERLESS_INGEST_RATE_PER_SECOND,
    PAPERLESS_UPLOADS_PER_ORG_PER_MINUTE: process.env.PAPERLESS_UPLOADS_PER_ORG_PER_MINUTE,
    PAPERLESS_READS_PER_ORG_PER_MINUTE: process.env.PAPERLESS_READS_PER_ORG_PER_MINUTE,
    PAPERLESS_HTTP_CONNECTIONS: process.env.PAPERLESS_HTTP_CONNECTIONS,
    PAPERLESS_STREAM_TIMEOUT_MS: process.env.PAPERLESS_STREAM_TIMEOUT_MS,
    PAPERLESS_ADMIN_URL: process.env.PAPERLESS_ADMIN_URL,
    PAPERLESS_ADMIN_USER: process.env.PAPERLESS_ADMIN_USER,
    PAPERLESS_ADMIN_PASSWORD: process.env.PAPERLESS_ADMIN_PASSWORD,
    PAPERLESS_TOKEN_ENCRYPTION_KEY: process.env.PAPERLESS_TOKEN_ENCRYPTION_KEY,
    CLAMAV_HOST: process.env.CLAMAV_HOST,
    CLAMAV_PORT: process.env.CLAMAV_PORT,
    POMOCNIK_WEBHOOK_SECRET: process.env.POMOCNIK_WEBHOOK_SECRET
  };
}

export function parseEnv(source: Record<string, string | undefined> = readProcessEnv()): AppEnv {
  const parsed = envSchema.safeParse(source);

  if (!parsed.success) {
    const message = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");

    throw new Error(`Invalid environment configuration: ${message}`);
  }

  return parsed.data;
}

export const env = parseEnv();

export function requireEnv<K extends keyof AppEnv>(key: K): NonNullable<AppEnv[K]> {
  const value = env[key];

  if (!value) {
    throw new Error(`Missing required environment variable: ${String(key)}`);
  }

  return value as NonNullable<AppEnv[K]>;
}
