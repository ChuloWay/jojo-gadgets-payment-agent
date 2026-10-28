import { z } from 'zod';

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1),
  PAYSTACK_SECRET_KEY: z.string().min(1),
  PAYSTACK_BASE_URL: z.string().url().default('https://api.paystack.co'),
  MCP_BEARER_TOKEN: z.string().min(24),
  PAYMENT_WINDOW_MINUTES: z.coerce.number().int().positive().default(30),
  DEMO_MODE: z.enum(['true', 'false']).default('false'),
  LOG_LEVEL: z.string().default('info'),
  CHORD_PROACTIVE_NOTIFICATIONS: z.enum(['true', 'false']).default('false'),
  CHORD_API_BASE_URL: z.string().url().default('https://api.chordhq.xyz'),
  CHORD_API_KEY: z.string().min(1).optional(),
  CHORD_WORKSPACE_ID: z.string().min(1).optional(),
  CHORD_TEAMMATE_ID: z.string().min(1).optional()
}).superRefine((env, ctx) => {
  if (env.CHORD_PROACTIVE_NOTIFICATIONS !== 'true') return;
  for (const key of ['CHORD_API_KEY', 'CHORD_WORKSPACE_ID', 'CHORD_TEAMMATE_ID'] as const) {
    if (!env[key]) ctx.addIssue({ code: 'custom', path: [key], message: `${key} is required when proactive notifications are enabled` });
  }
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
  chordProactiveNotifications: boolean;
  chordApiBaseUrl: string;
  chordApiKey?: string;
  chordWorkspaceId?: string;
  chordTeammateId?: string;
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
    logLevel: parsed.LOG_LEVEL,
    chordProactiveNotifications: parsed.CHORD_PROACTIVE_NOTIFICATIONS === 'true',
    chordApiBaseUrl: parsed.CHORD_API_BASE_URL,
    ...(parsed.CHORD_API_KEY ? { chordApiKey: parsed.CHORD_API_KEY } : {}),
    ...(parsed.CHORD_WORKSPACE_ID ? { chordWorkspaceId: parsed.CHORD_WORKSPACE_ID } : {}),
    ...(parsed.CHORD_TEAMMATE_ID ? { chordTeammateId: parsed.CHORD_TEAMMATE_ID } : {})
  };
}
