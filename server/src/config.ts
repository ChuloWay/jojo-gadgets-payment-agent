import { z } from 'zod';

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1),
  PAYSTACK_SECRET_KEY: z.string().min(1),
  PAYSTACK_BASE_URL: z.string().url().default('https://api.paystack.co'),
  MCP_BEARER_TOKEN: z.string().min(24),
  PAYMENT_WINDOW_MINUTES: z.coerce.number().int().positive().default(30),
  DEMO_MODE: z.enum(['true', 'false']).default('false'),
  LOG_LEVEL: z.string().default('info')
});

export type AppConfig = {
  port: number;
  databaseUrl: string;
  paystackSecretKey: string;
  paystackBaseUrl: string;
  mcpBearerToken: string;
  paymentWindowMinutes: number;
  demoMode: boolean;
  logLevel: string;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.parse(env);
  return {
    port: parsed.PORT,
    databaseUrl: parsed.DATABASE_URL,
    paystackSecretKey: parsed.PAYSTACK_SECRET_KEY,
    paystackBaseUrl: parsed.PAYSTACK_BASE_URL,
    mcpBearerToken: parsed.MCP_BEARER_TOKEN,
    paymentWindowMinutes: parsed.PAYMENT_WINDOW_MINUTES,
    demoMode: parsed.DEMO_MODE === 'true',
    logLevel: parsed.LOG_LEVEL
  };
}
