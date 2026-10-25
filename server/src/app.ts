import { timingSafeEqual } from 'node:crypto';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Request, Response, NextFunction } from 'express';
import pino, { type Logger } from 'pino';
import { pinoHttp } from 'pino-http';
import type { AppConfig } from './config.js';
import type { DatabasePool } from './db/pool.js';
import { createMcpServer } from './mcp/server.js';
import type { CommerceService } from './services/commerce-service.js';

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
  const app = createMcpExpressApp({ host: '0.0.0.0' });
  app.disable('x-powered-by');
  app.use(pinoHttp({ logger }));

  app.get('/healthz', async (_req, res) => {
    try {
      await dependencies.pool.query('SELECT 1');
      res.json({ status: 'ok' });
    } catch {
      res.status(503).json({ status: 'error' });
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
