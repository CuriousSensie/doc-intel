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
  // BullMQ queue (infra/docker-compose.yml's `redis-app` service) — separate Redis instance
  // from either of Paperless's, so an import backlog never starves our own app-level jobs.
  REDIS_URL: z.string().url().default("redis://localhost:6379")
});

export type AppEnv = z.infer<typeof envSchema>;

export function parseEnv(source: Record<string, string | undefined> = process.env): AppEnv {
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
