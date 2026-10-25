# Jojo Gadgets Payment Agent

A Chord teammate that quotes live gadget stock, reserves an item, creates a Paystack test checkout, and confirms payment only by verifying the generated reference. PostgreSQL owns prices, reservations, order state, and the audit trail; customer screenshots never determine payment state.

## Architecture

```text
WhatsApp simulator → Chord teammate + SKILL.md → Streamable HTTP MCP server
                                                   ├─ PostgreSQL
                                                   └─ Paystack test API
```

The MCP server exposes exactly three tools: `check_stock_and_quote`, `create_payment`, and `verify_payment`. Quote tokens bind the price the customer accepted to checkout creation. Orders are persisted as `INITIALIZING` before Paystack is called, and database locks make reservation and payment finalization idempotent.

## Local setup

Requirements: Node.js 22+ and PostgreSQL 14+ (or Docker).

```bash
cp .env.example .env
docker compose up -d postgres
npm install
npm run db:migrate
npm run seed
npm run dev
```

Useful commands:

```bash
npm run typecheck
TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:54329/gadget_agent npm test
npm run build
```

`npm run seed` clears demo orders, quotes, events, and alerts, then restores the six fictional SKUs. Never point it at production data.

## Environment

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `PAYSTACK_SECRET_KEY` | Paystack **test** secret, stored only on the server |
| `PAYSTACK_BASE_URL` | Defaults to `https://api.paystack.co` |
| `MCP_BEARER_TOKEN` | Long random token Chord uses to authenticate to `/mcp` |
| `HOLD_MINUTES` | Reservation duration; defaults to 30 |
| `PORT` | HTTP port; defaults to 3000 |
| `LOG_LEVEL` | Pino log level |

Do not commit `.env`, Chord credentials, Paystack keys, customer data, or real phone numbers.

## Deploy and connect Chord

1. Deploy this repository from the `Dockerfile` with a persistent PostgreSQL database. Set all environment variables, use `npm run db:migrate:prod` as the release/predeploy command, then run `npm run seed:prod` once for the demo.
2. Confirm `GET https://<host>/healthz` returns `{"status":"ok"}`.
3. In Chord, register `https://<host>/mcp` as a Streamable HTTP MCP server using bearer authentication. Store the same value as `MCP_BEARER_TOKEN` in the connection.
4. Run Chord tool discovery and health. Restrict `enabled_tools` to the three tool names above, then explicitly assign that MCP server to the teammate.
5. Upload [skills/SKILL.md](skills/SKILL.md), mark it as Instructions, review, publish, and activate the teammate.
6. Connect the external WhatsApp simulator application and run an in-app text test before spending credits on the recorded flow.

## Demo script

1. Ask for a PS5. The teammate looks up the live row and quotes the new 825GB Disc Edition at ₦780,000.
2. Agree to buy. The teammate reserves it and sends the Paystack test link, reference, and hold expiry.
3. Send a fake payment screenshot without checking out. The teammate rejects it as evidence, verifies the reference, and reports that no successful payment exists.
4. Pay through Paystack test checkout and say “Done, I’ve paid.” The teammate verifies the reference and sends the receipt details.
5. Say “I’ve paid” again. Verification returns the stored paid order without changing inventory or calling Paystack again.
6. Ask for the same PS5 as another demo customer and show that it is unavailable.

Use Paystack's currently documented test details from its official test-payments page. Do not put card data into the chat.

## Scope and limitations

This demo verifies payments initiated through its Paystack checkout. It does not reconcile arbitrary bank transfers. Underpayment is detected and flagged for owner review; automated top-ups, refunds, delivery, trade-ins, live WhatsApp, webhooks, and real owner notifications are outside this build.

Owner alerts are durable database records and structured logs. Customer copy therefore says “flagged for owner review,” not that a notification was delivered.

## AI assistance

Codex was used to review the product scope, check current Chord and Paystack documentation, scaffold the TypeScript service, and draft tests and documentation. The implementation is verified with TypeScript compilation, PostgreSQL integration tests, mocked provider-contract tests, and MCP tool discovery. Deployment-specific observations belong in `FIELD_NOTES.md` and should be recorded from actual Chord and simulator behavior.
