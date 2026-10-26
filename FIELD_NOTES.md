# Deployment field notes

Add a factual entry whenever the build, documentation, simulator, or provider behaves unexpectedly. Do not add hypothetical issues.

## Render free-tier Blueprint rejected `preDeployCommand`

- **When:** Initial Render Blueprint deployment, 26 October 2026
- **What happened:** Render found `render.yaml` but refused to create the resources with `services[0]: pre-deploy command is not supported for free tier services`.
- **How I found the cause:** The repository connected successfully and Render's Blueprint review displayed the validation error against the web service definition before provisioning anything. The application build and migrations had already passed locally, so this was a hosting-plan capability mismatch rather than an application failure.
- **Fix or workaround:** Removed `preDeployCommand` from the Blueprint and changed the production container command to run the idempotent database migration before starting the HTTP server. The one-time initial deploy hook still seeds only synthetic demo inventory.
- **What Render should change:** The Blueprint reference describes `preDeployCommand` as the recommended migration mechanism but does not flag the free-tier restriction beside that field. Show plan compatibility in the field reference and validate the YAML before the repository-connection flow.

## Entry template

- **When:** Step and timestamp
- **What happened:** Exact behavior, status, and redacted request/response excerpt
- **How I found the cause:** Checks performed in order
- **Fix or workaround:** What worked or remains unresolved
- **What Chord should change:** A specific documentation, API, SDK, or error-message improvement
