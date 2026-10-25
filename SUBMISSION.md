# TSG Labs Build Exercise submission draft

## Role preference

Forward-deployed Engineering and Technical Product Management.

## Business context

Jojo Gadgets is a real gadget business in Computer Village, Ikeja, Lagos. The owner is Uchenna Joseph Etokwudo. Discovery notes confirm the shop's transfer-and-receipt process, manual bank-app verification, financial loss from fake alerts, a customer dispute after a delayed payment reversed, manual stock book, suitability of a checkout link or transaction-specific temporary account, and default three-month warranty. Depending on market activity, Uchenna checks tens of payments in a week and can approach roughly 100 in a busy week. He estimates cumulative fake-alert losses in the hundreds of thousands to millions of naira. These are owner-reported ranges, not audited figures, and all notes are paraphrased rather than verbatim quotations.

All customer identities, phone numbers, inventory rows, prices, Paystack transactions, and detailed address data in the build are synthetic. The three-month default warranty comes from discovery, while its item-specific coverage and remedies remain unconfirmed.

## Problem statement draft

Jojo Gadgets sells laptops, consoles, and phones from Computer Village, Ikeja. Customers pay by bank transfer and send a receipt to the shop's WhatsApp Business account, but fake alerts have caused owner-estimated cumulative losses in the hundreds of thousands to millions of naira. Depending on market activity, Uchenna checks tens of payments in a week and can approach roughly 100 in a busy week; every receipt interrupts him because he opens his bank app to confirm the credit. One delayed payment that later reversed also led to a customer dispute. This Chord teammate replaces that manual matching step for agent-generated payments by quoting controlled test inventory, creating a Paystack test checkout with a unique reference, and allocating stock only after that reference is verified as paid. Delivery logistics, trade-ins, installments, negotiation, refunds, direct temporary-account issuance, live credentials, and real customer data are deliberately outside the demonstration.

The volume and loss figures are intentionally expressed as owner-reported ranges. Verification time is not presented as a fabricated average: Uchenna checks when the receipt arrives, while downtime makes the wait unpredictable.

## Synthetic demo identity and policies

- **Business:** Jojo Gadgets
- **Owner:** Uchenna Joseph Etokwudo
- **Demo location:** Computer Village, Ikeja, Lagos; no street address or real pickup details are used
- **Warranty:** Three months by default; it may vary with the acquisition deal for a specific device
- **Returns:** No policy has been supplied; all requests go to owner review
- **Owner review:** Faults, replacements, cancellations, refunds, delivery, trade-ins, bulk orders, and payment disputes

The confirmed details can be used in the test conversation. Item-specific warranty coverage and unconfirmed return terms must not be presented as established business policy.

## Remaining discovery questions

1. Who besides Uchenna can update the stock book or confirm payment?
2. What are the exact warranty exclusions, return terms, pickup process, and delivery policy?
3. Of the weekly payment checks, how many become delayed, disputed, or require a second check?

Record the answers faithfully. One concrete quote and one measured fact are more useful than invented detail.
