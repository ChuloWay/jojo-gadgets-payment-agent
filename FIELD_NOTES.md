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
- **Fix or workaround:** Replaced the one-time hook with a non-destructive startup step that inserts only missing SKUs using `ON CONFLICT DO NOTHING`. It runs after the idempotent migration on every container start without resetting quantities, orders, payment events, or alerts. The destructive `npm run seed` command remains local/demo-reset tooling only.
- **What Render should change:** Surface initial-deploy-hook execution and logs beside the main deploy status, and make it obvious when a service is live even though its initial hook did not populate required data.

## Entry template

- **When:** Step and timestamp
- **What happened:** Exact behavior, status, and redacted request/response excerpt
- **How I found the cause:** Checks performed in order
- **Fix or workaround:** What worked or remains unresolved
- **What Chord should change:** A specific documentation, API, SDK, or error-message improvement
