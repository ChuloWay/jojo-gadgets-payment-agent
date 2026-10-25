# Jojo Gadgets discovery notes

- **Business:** Jojo Gadgets
- **Owner:** Uchenna Joseph Etokwudo
- **Location:** Computer Village, Ikeja, Lagos
- **Recorded:** 25 October 2026
- **Evidence type:** Paraphrased notes supplied by Victor; these are not verbatim quotations

## Current payment process

Customers pay by bank transfer and send the receipt to the shop's WhatsApp Business account. Uchenna confirms payment by opening his bank application and checking that the money actually arrived.

## Fraud and operational problem

The business has previously dealt with scammers sending fake payment alerts. That experience is why Uchenna does not rely on the receipt or alert sent by the customer and always checks the bank application himself.

When the bank service is unavailable or a transfer does not appear promptly, verification takes longer. Uchenna collects the customer's phone number so he can follow up after checking again.

## Fit of the proposed payment flow

Customers normally come to the physical shop, so Uchenna considers it practical to give them a checkout link. He would also consider a temporary bank account generated specifically for that payment.

The current build uses a Paystack test checkout with a unique reference. A temporary or dedicated virtual account is a possible later integration, not part of this demonstration.

## Stock and holds

Uchenna tracks stock manually in a book. A hold does not reduce physical stock; only a completed purchase does. If a hold expires, he moves on to the next sale.

The demo represents this with separate `qty_available` and `qty_held` values. Creating a payment moves one unit from available to held while total physical stock remains unchanged. Verified payment removes the held unit from stock; expiry returns it to available.

## Warranty

The default warranty is three months. It can vary depending on the deal under which Uchenna acquired the particular device, so the warranty for a specific item must be confirmed before the sale is finalized.

## Product implications

1. Never confirm payment from a customer receipt or alert.
2. Match every checkout and verification attempt to a unique reference.
3. Capture the customer's phone number before payment so unresolved checks can be followed up.
4. Keep unavailable verification pending and flag it for owner review.
5. Treat a hold as a temporary allocation, not a completed stock deduction.
6. Reconcile the agent's inventory with the owner's book and walk-in sales before any real launch.
7. Present three months as the default warranty and refer item-specific coverage to Uchenna.

## Follow-up questions

- Approximately how many WhatsApp payment checks does the shop perform in a typical week?
- Roughly how many minutes does a normal check take, and how long can it take during bank downtime?
- Has a fake alert ever caused a financial loss, or has manual checking caught every attempt so far?
- Who besides Uchenna can update the stock book or confirm a payment?
- What exact event makes an item unavailable to the next customer: payment, collection, or an owner-approved hold?
