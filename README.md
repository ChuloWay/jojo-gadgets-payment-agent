# Jojo Gadgets Payment Agent

A Chord teammate that quotes live gadget stock, creates a time-limited Paystack test checkout, and confirms payment only by verifying the generated reference. PostgreSQL owns prices, stock allocation, order state, and the audit trail; customer screenshots never determine payment state.

The workflow is based on discovery with Jojo Gadgets: customers currently transfer funds and send receipts through WhatsApp Business, Uchenna checks the bank app manually because fake alerts have caused owner-estimated losses in the hundreds of thousands to millions of naira, and stock is tracked in a handwritten book. Depending on market activity, he performs tens of checks in a week and can approach roughly 100 in a busy week. See `INTERVIEW_NOTES.md` for the paraphrased findings and remaining questions.

## Architecture

```text
WhatsApp simulator → Chord teammate + SKILL.md → Streamable HTTP MCP server
                                                   ├─ PostgreSQL
                                                   └─ Paystack test API
```

The MCP server exposes four tools: `check_stock_and_quote`, `create_payment`, `verify_payment`, and `capture_fulfillment_preference`. Quote tokens bind the price the customer accepted to checkout creation. Orders are persisted as `INITIALIZING` before Paystack is called, and database locks allocate stock exactly once when payment is verified. Creating a checkout does not reserve stock, matching the business's fast-moving Computer Village sales process. After payment, the fourth tool stores a pickup-time preference or delivery request for owner confirmation without promising an appointment, fee, or dispatch.

Paystack can also finalize an order without waiting for the customer to type “paid.” `POST /webhooks/paystack` validates the HMAC-SHA512 signature over the exact raw body, durably deduplicates `charge.success` events by provider transaction ID, and re-verifies the exact internal reference with Paystack before using the same locked stock-allocation path. Only the event type, provider transaction ID, and internal reference are retained from the webhook; unnecessary customer and payment payload fields are discarded. A persistent retry queue recovers from transient verification failures. Events for other Paystack integrations are acknowledged and ignored rather than misapplied to a Jojo Gadgets order.

The repository also contains an opt-in, exact-reference Chord thread notifier, but it is disabled in the assessment deployment. It locates only a unique external-chat thread containing an agent-authored checkout turn with the exact reference and Paystack URL, refuses ambiguous or missing routes, and deduplicates receipts. Live testing showed that Chord persisted its operator-authored turn with `delivery_status: sent` but the WhatsApp simulator did not render it; takeover also persisted a misleading “connecting you with a teammate” system turn. The reliable live behavior is therefore automatic backend finalization, followed by an idempotent receipt on the customer's next message. See `FIELD_NOTES.md`.

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
| `PAYMENT_WINDOW_MINUTES` | Checkout window shown to the customer; defaults to 30 |
| `PORT` | HTTP port; defaults to 3000 |
| `LOG_LEVEL` | Pino log level |
| `CHORD_PROACTIVE_NOTIFICATIONS` | Opt-in experimental Chord thread notifier; disabled by default and in the assessment deployment |
| `CHORD_API_BASE_URL` | Chord API host; defaults to `https://api.chordhq.xyz` |
| `CHORD_API_KEY` | Server-only key scoped to `thread:read` and `thread:write` |
| `CHORD_WORKSPACE_ID` | Workspace whose external-chat threads are searched |
| `CHORD_TEAMMATE_ID` | Jojo teammate whose checkout turns are eligible routes |

Do not commit `.env`, Chord credentials, Paystack keys, customer data, or real phone numbers.

## Deploy and connect Chord

The included `render.yaml` creates a Frankfurt web service and PostgreSQL database and generates the MCP bearer token. The production container applies idempotent migrations and inserts only missing synthetic SKUs before starting the server because Render's free web tier does not support pre-deploy commands. Existing stock quantities and orders are never reset on restart. The Blueprint deliberately prompts for `PAYSTACK_SECRET_KEY` instead of storing it in Git.

The Blueprint selects Render's free demo plans. These are suitable for this assessment, not production: the web service can cold-start after being idle and the free database expires after 30 days.

The assessment deployment is live at `https://jojo-gadgets-payment-agent.onrender.com`. Its MCP endpoint is `https://jojo-gadgets-payment-agent.onrender.com/mcp` and its health endpoint is `https://jojo-gadgets-payment-agent.onrender.com/healthz`.

The active Chord teammate is **Jojo Gadgets Sales Assistant**. Its WhatsApp-style simulator link is `https://chat.tsglabs.dev/c/Qj7tFLNSBng9ENG9vc-dmrGS`.

1. In Render, create a Blueprint from this repository and enter a **Paystack test** secret when prompted. Never use a live key for the exercise.
2. Confirm `GET https://jojo-gadgets-payment-agent.onrender.com/healthz` returns `{"status":"ok"}`.
3. In the Paystack **test** environment, set the webhook URL to `https://jojo-gadgets-payment-agent.onrender.com/webhooks/paystack`. The endpoint uses the same test secret configured as `PAYSTACK_SECRET_KEY`; never put that secret in the URL.
4. In Chord, register `https://jojo-gadgets-payment-agent.onrender.com/mcp` as a Streamable HTTP MCP server using bearer authentication. Store the same value as `MCP_BEARER_TOKEN` in the connection.
5. Run Chord tool discovery and health and restrict the server's allowed tools to the four tool names above. Chord exposes enabled custom MCP servers to the teammate; confirm this from an actual teammate tool trace rather than expecting the connector in the built-in-tool switch list.
6. Upload [skills/SKILL.md](skills/SKILL.md), mark it as Instructions, review, publish, and activate the teammate.
7. Enable both the organization-wide **Allow approved apps** switch and the **Whatsapp Simulator** app, authorize the simulator, and create the chat link. One in-app text test confirmed the teammate could call the MCP quote tool; further conversation turns are reserved for the recorded flow to conserve credits.

## Demo script

1. Ask for a PS5. The teammate looks up the live row and quotes the new 825GB Disc Edition at ₦780,000.
2. Agree to buy. The teammate sends the Paystack test link, reference, and payment-window expiry and explains that stock is allocated after verified payment.
3. Send a fake payment screenshot without checking out. The teammate rejects it as evidence, verifies the reference, and reports that no successful payment exists.
4. Pay through Paystack test checkout and do not send “paid.” The webhook automatically verifies the exact reference and allocates stock once. This can be demonstrated from the server's durable order and webhook state without spending another Chord turn.
5. Send the next useful request directly: pickup with an approximate arrival time, or delivery with an area, recipient name, phone, and optional landmark. The teammate finds the already-paid order, gives the receipt, records the preference for owner confirmation, and does not promise dispatch or a fee.
6. Ask for the same item again. The teammate must perform a fresh stock check and report sold out if that purchase consumed the last unit.

Use Paystack's currently documented test details from its official test-payments page. Do not put card data into the chat.

## Scope and limitations

This demo verifies payments initiated through its Paystack checkout. It does not reconcile arbitrary bank transfers. Underpayment is detected and flagged for owner review. A delivery request can be recorded, but delivery pricing, availability, courier dispatch, and tracking are not automated. True proactive customer chat delivery remains disabled because Chord's public API has no agent-authored proactive endpoint for an existing channel thread, and the available operator-message path did not render in the simulator during two live tests. Automated top-ups, refunds, trade-ins, live WhatsApp, and real owner notifications remain outside this build.

Owner alerts are durable database records and structured logs. Customer copy therefore says “flagged for owner review,” not that a notification was delivered.

## AI assistance

Codex was used to review the product scope, check current Chord and Paystack documentation, scaffold the TypeScript service, and draft tests and documentation. The implementation is verified with TypeScript compilation, PostgreSQL integration tests, mocked provider-contract tests, and MCP tool discovery. Deployment-specific observations belong in `FIELD_NOTES.md` and should be recorded from actual Chord and simulator behavior.
