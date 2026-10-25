# Jojo Gadgets discovery notes

- **Business:** Jojo Gadgets
- **Owner:** Uchenna Joseph Etokwudo
- **Location:** Computer Village, Ikeja, Lagos
- **Recorded:** 25 October 2026
- **Evidence type:** Paraphrased notes supplied by Victor; these are not verbatim quotations

## Current payment process

Customers pay by bank transfer and send the receipt to the shop's WhatsApp Business account. Uchenna confirms payment by opening his bank application and checking that the money actually arrived.

## Fraud and operational problem

The business has previously lost money because of scammers sending fake payment alerts. That experience is why Uchenna does not rely on the receipt or alert sent by the customer and always checks the bank application himself.

When the bank service is unavailable or a transfer does not appear promptly, verification takes longer. Uchenna collects the customer's phone number so he can follow up after checking again. In one case, a delayed payment was later reversed and caused a dispute because the customer would not resend the money immediately.

## Fit of the proposed payment flow

Customers normally come to the physical shop, so Uchenna considers it practical to give them a checkout link. He would also consider a temporary bank account generated specifically for that payment.

The current build uses a Paystack test checkout with a unique reference. A temporary or dedicated virtual account is a possible later integration, not part of this demonstration.

## Stock and payment windows

Uchenna tracks stock manually in a book. Computer Village deals happen continuously, including enquiries from other vendors looking for products they do not have. An exclusive hold is therefore difficult to honor; only a completed purchase affects stock, and an unpaid customer cannot block the next sale.

The demo now treats checkout expiry as a payment window rather than an inventory reservation. Creating a payment does not change stock. Successful verification allocates one unit atomically; if the final unit was sold through another deal first, the order becomes `PAID_NEEDS_OWNER` for resolution.

## Warranty

The default warranty is three months. It can vary depending on the deal under which Uchenna acquired the particular device, so the warranty for a specific item must be confirmed before the sale is finalized.

## Product implications

1. Never confirm payment from a customer receipt or alert.
2. Match every checkout and verification attempt to a unique reference, and never treat a pending, delayed, failed, or reversed provider status as paid.
3. Capture the customer's phone number before payment so unresolved checks can be followed up.
4. Keep unavailable verification pending and flag it for owner review.
5. Do not promise an exclusive hold; allocate stock only after verified payment.
6. Reconcile the agent's inventory with the owner's book and walk-in sales before any real launch.
7. Present three months as the default warranty and refer item-specific coverage to Uchenna.

## Follow-up questions

- Approximately how many WhatsApp payment checks does the shop perform in a typical week?
- Roughly how many minutes does a normal check take, and how long can it take during bank downtime?
- Has a fake alert ever caused a financial loss, or has manual checking caught every attempt so far?
- Who besides Uchenna can update the stock book or confirm a payment?
- Should the payment window be shorter than 30 minutes for fast-moving items?
