# Deployment field notes

Add a factual entry whenever the build, documentation, simulator, or provider behaves unexpectedly. Do not add hypothetical issues.

## Render free-tier Blueprint rejected `preDeployCommand`

- **When:** Initial Render Blueprint deployment, 26 October 2026
- **What happened:** Render found `render.yaml` but refused to create the resources with `services[0]: pre-deploy command is not supported for free tier services`.
- **How I found the cause:** The repository connected successfully and Render's Blueprint review displayed the validation error against the web service definition before provisioning anything. The application build and migrations had already passed locally, so this was a hosting-plan capability mismatch rather than an application failure.
- **Fix or workaround:** Removed `preDeployCommand` from the Blueprint and changed the production container command to run the idempotent database migration before starting the HTTP server.
- **What Render should change:** The Blueprint reference describes `preDeployCommand` as the recommended migration mechanism but does not flag the free-tier restriction beside that field. Show plan compatibility in the field reference and validate the YAML before the repository-connection flow.

## Render initial deploy left the inventory empty

- **When:** First successful web-service deploy, 26 October 2026
- **What happened:** Render reported a successful deploy and both `/healthz` and authenticated MCP tool discovery worked, but calling `check_stock_and_quote` for `PS5` returned `no_match`. The PostgreSQL schema existed, but the expected six synthetic SKU rows did not.
- **How I found the cause:** I exercised the deployed MCP endpoint rather than relying on the green deploy status. The server exposed all three tools, authentication worked, and only the data-backed quote failed, isolating the problem to initial data population. The Blueprint's `initialDeployHook` had not produced the expected inventory.
- **Fix or workaround:** Replaced the one-time hook with a non-destructive startup step that inserts only missing SKUs using `ON CONFLICT DO NOTHING`. It runs after the idempotent migration on every container start without resetting quantities, orders, payment events, or alerts. The destructive `npm run seed` command remains local/demo-reset tooling only. After redeployment, an authenticated live MCP call for `PS5` returned the expected 825GB Disc Edition at ₦780,000 with stock 1.
- **What Render should change:** Surface initial-deploy-hook execution and logs beside the main deploy status, and make it obvious when a service is live even though its initial hook did not populate required data.

## Chord surfaced internal search commentary in a customer reply

- **When:** First live teammate test in Chord, 28 October 2026
- **What happened:** The teammate correctly called the custom MCP server and found the in-stock PS5 after broadening its search, but the final customer-facing reply appended an "operator" note explaining that the first query returned no match and that search appeared sensitive to wording.
- **How I found the cause:** Chord's "How I did this" trace showed three `check_stock_and_quote` calls: one narrow query returned `no_match`, while two broader queries returned the correct `PS5-DISC-NEW` result. The final reply exposed a summary of that recovery even though the skill already said not to reveal internal tool details.
- **Fix or workaround:** Strengthened the skill so every reply is explicitly customer-facing, internal search attempts are never mentioned, and one shorter retry happens silently after an initial no-match. To conserve the assessment's limited credits, the revised wording will be confirmed during the recorded end-to-end demo instead of spending another pre-demo conversation.
- **What Chord should change:** Keep tool/reasoning traces separate from the reply-generation context, or provide a first-class policy switch that prevents tool-recovery commentary from being surfaced to customers.

## Simulator app was allowed but organization-wide access was disabled

- **When:** WhatsApp simulator authorization, 28 October 2026
- **What happened:** The simulator OAuth page rejected access with “Access to Whatsapp Simulator isn't enabled for this organization.” In Admin → Connected apps, the Whatsapp Simulator row was already marked as ready/allowed, but the separate organization-wide **Allow approved apps** switch was disabled.
- **How I found the cause:** Retried authorization after confirming the app-specific row, then opened the active Chuloway organization's Connected Apps page. The page showed `Whatsapp Simulator` as allowed while Chord Connect itself said “No app can access or request new access.”
- **Fix or workaround:** Enabled the organization-wide Chord Connect switch, retried OAuth, approved the requested scopes, and created the Jojo Gadgets simulator link without starting another conversation.
- **What Chord should change:** The OAuth error should distinguish an app-specific denial from the organization-wide master switch and link directly to the disabled setting. The app row should not appear “Allowed” without an adjacent warning when the master switch makes that state ineffective.

## Simulator displayed Markdown literally and exposed exact stock

- **When:** First paid end-to-end simulator conversation, 28 October 2026
- **What happened:** The teammate completed the quote, checkout, and verified-payment flow, but customer messages displayed Markdown markers such as `**Item:**` literally. The quote also said “Only 1 unit available,” exposing an internal inventory count that the customer did not need.
- **How I found the cause:** Reviewed the visible WhatsApp simulator transcript after the successful payment. Chord passed the teammate's Markdown-style reply through without rendering the emphasis markers, and the model repeated the tool's numeric `available` value.
- **Fix or workaround:** Published a stricter skill style policy: plain WhatsApp text only, no Markdown syntax, exact quantities and inventory history remain internal, positive stock is described only as available, and zero stock is described as sold out. Every new purchase request must perform a fresh stock lookup. A follow-up confirmed the plain formatting and sold-out state, but the teammate still said the customer had bought the “last one” and unnecessarily repeated the prior payment details; the next revision explicitly prohibited both behaviors.
- **What Chord should change:** Document the simulator's supported message formatting and provide a channel-aware rendering preview or lint warning when teammate output contains unsupported Markdown.

## Entry template

- **When:** Step and timestamp
- **What happened:** Exact behavior, status, and redacted request/response excerpt
- **How I found the cause:** Checks performed in order
- **Fix or workaround:** What worked or remains unresolved
- **What Chord should change:** A specific documentation, API, SDK, or error-message improvement
