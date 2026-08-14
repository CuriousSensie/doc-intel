import { z } from "zod";

const emailModeSchema = z.enum(["console", "resend", "dev-recipient"]);

export const envSchema = z.object({
  NEXT_PUBLIC_APP_URL: z.string().url().default("http://localhost:3000"),
  NEXT_PUBLIC_APP_NAME: z.string().min(1).default("MVP Boilerplate"),
  SUPPORT_EMAIL: z.string().email().default("support@example.com"),
  NEXT_PUBLIC_SUPABASE_URL: z.string().url().optional().or(z.literal("")),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().min(1).default("MVP Boilerplate <no-reply@example.com>"),
  EMAIL_MODE: emailModeSchema.default("console"),
  EMAIL_DEV_RECIPIENT: z.string().email().optional().or(z.literal("")),
  RATE_LIMIT_MODE: z.enum(["memory", "external"]).default("memory")
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
