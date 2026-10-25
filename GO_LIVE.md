# Go-live note

This build is a test-mode demonstration. Before real customers use it, the vendor needs to adopt generated checkout links as the supported payment path and keep all sales channels on the same stock source. Arbitrary bank transfers, walk-in sales, delivery, refunds, trade-ins, installments, and disputes still require an owner-operated process.

Production readiness requires live Paystack credentials in a managed secret store, verified Paystack webhooks feeding the same idempotent payment-finalization path, a delivered owner-notification channel, database backups and recovery drills, monitoring and alerts, retention rules for customer identifiers and provider payloads, and a documented reconciliation process for ambiguous provider outcomes. Access to stock and order data should be limited by role and every manual correction should be audited.

Before launch, run a controlled pilot with low-value inventory. Measure verification time, owner-review rate, expired holds, duplicate tool calls, inventory mismatches, and failed notification delivery. The assistant must continue to say that only reference verification confirms payment, even when a customer supplies a convincing screenshot or insists that a transfer succeeded.
