# Source of Truth

This repository is the authoritative implementation source for Cards by Raaduns. This document and CTO-approved decisions in the project specification take precedence over assumptions and generated implementation details.

## Product
Cards by Raaduns sells virtual payment cards. The customer-facing Buy page must be a simple, direct purchase entry point: headline, approved KYC statement, payment-card imagery, available denominations, then the minimum information needed to place an order.

## Approved customer-facing content and flow
- Primary headline: **Get Your Virtual Card Instantly**
- Supporting claim: **NO KYC REQUIRED** — explicitly approved by the CTO on 2026-11-02 for publication. This is an approved product claim; operations must still comply with issuer, provider, and applicable legal requirements.
- The landing page must not lead with email verification, login, or explanatory paragraphs.
- Show payment-card imagery for Mastercard and Visa. Visa imagery is promotional/illustrative only until a Visa issuance provider and route are verified. Do not represent Visa as currently purchasable or accept Visa card orders before that gate is cleared.
- Show the fixed USD denominations: 20, 30, 50, 100, 150, 200.
- Custom amount remains configurable by administrators; exact limits must be set in admin configuration.
- After denomination selection, collect the email address as part of order creation and continue to payment. Do not require an email OTP before the customer can view products or select a denomination. Any order-ownership verification must be applied at the appropriate protected customer/order access step.

## Approved technology and operations
- Frontend: React.
- Backend: Node.js 22 with TypeScript.
- Database: MySQL.
- Payment provider: Flutterwave.
- Card provider: Kripicard, standard API account; CTO confirms Kripicard authorised the account for card creation for resale.
- Fulfilment: API by default; staff manually handles exceptions.
- Customer balance check: customer enters the card number. The backend must securely resolve it to the internal/provider card record; never expose provider credentials or card secrets to the browser.
- Webhooks: separate endpoints at /webhooks/flutterwave and /webhooks/kripicard.

## Security requirements
- Never commit secrets, credentials, tokens, database passwords, or card PAN/CVV/expiry values.
- Read secrets from server-side environment variables or a secrets manager. Use placeholders in examples.
- Treat credentials shared in chat as compromised and rotate them before production use.
- Verify payment server-side using provider-supported webhook signature verification and/or transaction verification. Never trust browser payment claims.
- Make webhook processing idempotent and persist event identifiers/status transitions.
- Restrict admin access with authentication, authorization, audit logging, and secure session handling.
- Do not log full card numbers, CVV, API keys, passwords, or webhook secrets.
- Use HTTPS for all customer and provider traffic.

## Provider constraints and unresolved items
- Kripicard documentation supplied to the project describes card creation as Mastercard issuance.
- Visa imagery may be displayed, but Visa must remain unavailable for purchase until a provider, issuance route, and integration have been verified and the CTO approves activation.
- Kripicard API details and balance responses may be pending or unknown. Display unknown/pending balance states accurately; never substitute zero for an unknown balance.
- The supplied Kripicard card-details endpoint accepts provider card_id (preferred) or last4, not a full PAN. Customer PAN lookup must be implemented through a protected internal mapping, or replaced by a safer provider-supported identifier if available.
- Flutterwave webhook signature and payment verification details must be implemented against the current official provider documentation before production.
- Database connection values are deployment configuration, not source code. Use MYSQL_HOST, MYSQL_DATABASE, MYSQL_USER, MYSQL_PASSWORD.
- The currently exposed database, Kripicard, FTP, and SFTP credentials must be rotated before production use.

## Change control
Any change to an approved business rule, provider, pricing, fulfilment policy, card network, or customer flow requires CTO approval and an update to the relevant specification and decision log.
