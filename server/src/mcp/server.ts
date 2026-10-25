import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { Logger } from 'pino';
import type { CommerceService, ToolResult } from '../services/commerce-service.js';

function response(result: ToolResult) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(result) }],
    structuredContent: result
  };
}

function failure(error: unknown, logger?: Logger) {
  logger?.error({ error }, 'MCP tool execution failed');
  return {
    isError: true,
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify({
          status: 'internal_error',
          message_for_agent: 'The tool could not complete safely. Do not infer stock or payment state; ask for owner review.'
        })
      }
    ]
  };
}

export function createMcpServer(commerce: CommerceService, logger?: Logger): McpServer {
  const server = new McpServer({ name: 'gadget-vendor-payment-tools', version: '0.1.0' });

  server.registerTool(
    'check_stock_and_quote',
    {
      title: 'Check stock and quote',
      description: 'Look up live gadget stock and return current price, availability, and a short-lived quote token. Use before stating any price.',
      inputSchema: {
        query: z.string().trim().min(1).optional().describe('Free-text product search, such as PS5 or iPhone 13'),
        sku: z.string().trim().min(1).optional().describe('Exact SKU when already known'),
        condition: z.enum(['new', 'uk_used', 'refurbished']).optional()
      },
      annotations: { readOnlyHint: true, openWorldHint: false }
    },
    async (input) => {
      try {
        return response(await commerce.checkStock(input));
      } catch (error) {
        return failure(error, logger);
      }
    }
  );

  server.registerTool(
    'create_payment',
    {
      title: 'Create payment',
      description: 'Atomically reserve one unit at the previously quoted price and initialize a Paystack test checkout. Call only after the customer confirms the exact item and total.',
      inputSchema: {
        sku: z.string().trim().min(1),
        quote_token: z.string().trim().min(1).describe('Token returned with the selected stock quote'),
        customer_phone: z.string().trim().min(7).max(32),
        customer_name: z.string().trim().min(1).max(120)
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    },
    async (input) => {
      try {
        return response(await commerce.createPayment({
          sku: input.sku,
          quoteToken: input.quote_token,
          customerPhone: input.customer_phone,
          customerName: input.customer_name
        }));
      } catch (error) {
        return failure(error, logger);
      }
    }
  );

  server.registerTool(
    'verify_payment',
    {
      title: 'Verify payment',
      description: 'Verify an order directly with Paystack using its reference. This is the only tool allowed to confirm payment and finalize inventory.',
      inputSchema: {
        reference: z.string().trim().regex(/^GDG-\d{8}-[A-Z2-9]{8}$/)
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    },
    async ({ reference }) => {
      try {
        return response(await commerce.verifyPayment(reference));
      } catch (error) {
        return failure(error, logger);
      }
    }
  );

  return server;
}
