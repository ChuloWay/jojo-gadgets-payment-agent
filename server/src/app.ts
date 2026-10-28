import { timingSafeEqual } from 'node:crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import express, { type Request, type Response, type NextFunction } from 'express';
import pino, { type Logger } from 'pino';
import { pinoHttp } from 'pino-http';
import type { AppConfig } from './config.js';
import type { DatabasePool } from './db/pool.js';
import { createMcpServer } from './mcp/server.js';
import { parsePaystackWebhook, validPaystackSignature } from './paystack/webhook.js';
import type { CommerceService } from './services/commerce-service.js';

type RawBodyRequest = Request & { rawBody?: Buffer };

function authorized(actual: string | undefined, expected: string): boolean {
  if (!actual?.startsWith('Bearer ')) return false;
  const supplied = Buffer.from(actual.slice('Bearer '.length));
  const wanted = Buffer.from(expected);
  return supplied.length === wanted.length && timingSafeEqual(supplied, wanted);
}

export function createApp(dependencies: {
  config: AppConfig;
  pool: DatabasePool;
  commerce: CommerceService;
  logger?: Logger;
}) {
  const logger = dependencies.logger ?? pino({ level: dependencies.config.logLevel, redact: ['req.headers.authorization'] });
  const app = express();
  app.disable('x-powered-by');
  app.use(pinoHttp({ logger }));
  app.use(express.json({
    limit: '1mb',
    verify: (req, _res, buffer) => {
      (req as RawBodyRequest).rawBody = Buffer.from(buffer);
    }
  }));

  app.get('/healthz', async (_req, res) => {
    try {
      await dependencies.pool.query('SELECT 1');
      res.json({ status: 'ok' });
    } catch {
      res.status(503).json({ status: 'error' });
    }
  });

  app.post('/webhooks/paystack', async (req: RawBodyRequest, res: Response) => {
    const signature = req.header('x-paystack-signature');
    if (!req.rawBody || !validPaystackSignature(req.rawBody, signature, dependencies.config.paystackSecretKey)) {
      res.status(401).json({ error: 'invalid_signature' });
      return;
    }

    const parsed = parsePaystackWebhook(req.body);
    if (!parsed) {
      res.status(400).json({ error: 'invalid_event' });
      return;
    }
    if (parsed.kind === 'ignored') {
      res.status(200).json({ received: true, ignored: true });
      return;
    }

    try {
      const queued = await dependencies.commerce.enqueuePaystackWebhook(parsed);
      res.status(200).json({ received: true, duplicate: !queued });
      if (queued) {
        setImmediate(() => {
          void dependencies.commerce.processPendingPaystackWebhooks(10)
            .catch((error) => logger.error({ error }, 'Paystack webhook background processing failed'));
        });
      }
    } catch (error) {
      logger.error({ error }, 'Paystack webhook could not be persisted');
      res.status(503).json({ error: 'temporarily_unavailable' });
    }
  });

  const requireMcpAuth = (req: Request, res: Response, next: NextFunction) => {
    if (!authorized(req.header('authorization'), dependencies.config.mcpBearerToken)) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    next();
  };

  app.post('/mcp', requireMcpAuth, async (req, res) => {
    const server = createMcpServer(dependencies.commerce, logger);
    const transport = new StreamableHTTPServerTransport({});
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      logger.error({ error }, 'MCP request failed');
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: { code: -32603, message: 'Internal server error' },
          id: null
        });
      }
    } finally {
      res.on('close', () => {
        void transport.close();
        void server.close();
      });
    }
  });

  app.get('/mcp', requireMcpAuth, (_req, res) => {
    res.status(405).json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed' }, id: null });
  });
  app.delete('/mcp', requireMcpAuth, (_req, res) => {
    res.status(405).json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed' }, id: null });
  });

  return app;
}
