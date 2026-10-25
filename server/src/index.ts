import 'dotenv/config';
import pino from 'pino';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { createPool } from './db/pool.js';
import { PaystackClient } from './paystack/client.js';
import { CommerceService } from './services/commerce-service.js';

const config = loadConfig();
const logger = pino({ level: config.logLevel, redact: ['req.headers.authorization'] });
const pool = createPool(config.databaseUrl);
const provider = new PaystackClient(config.paystackSecretKey, config.paystackBaseUrl);
const commerce = new CommerceService(pool, provider, config.holdMinutes, logger);
const app = createApp({ config, pool, commerce, logger });

const server = app.listen(config.port, '0.0.0.0', () => {
  logger.info({ port: config.port }, 'gadget payment MCP server listening');
});

const sweep = setInterval(() => {
  void commerce.sweepExpired().then((count) => {
    if (count > 0) logger.info({ count }, 'expired reservations released');
  }).catch((error) => logger.error({ error }, 'reservation sweep failed'));
}, 60_000);
sweep.unref();

async function shutdown(signal: string) {
  logger.info({ signal }, 'shutting down');
  clearInterval(sweep);
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
