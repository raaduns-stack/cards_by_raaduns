# Source of Truth

This repository is the authoritative implementation source for Cards by Raaduns. In case of conflict, this file and CTO-approved decisions in the project specification take precedence over assumptions, examples, and generated implementation details.

## Product
Cards by Raaduns sells virtual payment cards. Customers select a card network where available, choose a fixed or custom amount, provide an email address, complete payment, and receive card delivery by email after fulfilment.

## Approved decisions
- Frontend: React.
- Backend: Node.js 22 with TypeScript.
- Database: MySQL.
- Payment provider: Flutterwave.
- Card provider: Kripicard, standard API account; CTO confirms Kripicard authorised the account for card creation for resale.
- Fulfilment: API by default; staff manually handles exceptions.
- Card denominations: USD 20, 30, 50, 100, 150, 200.
- Custom amount: configurable by administrators; exact limits must be set in admin configuration.
- Customer balance check: customer enters the card number. The backend must securely resolve it to the internal/provider card record; never expose provider credentials or card secrets to the browser.
- Webhooks: separate endpoints at /webhooks/flutterwave and /webhooks/kripicard.

## Security requirements
- Never commit secrets, credentials, tokens, database passwords, or card PAN/CVV/expiry values.
- Read secrets from server-side environment variables or a secrets manager. Use placeholders in examples.
- Treat credentials shared in chat as compromised and rotate them before use.
- Verify payment server-side using provider-supported webhook signature verification and/or transaction verification. Never trust browser payment claims.
- Make webhook processing idempotent and persist event identifiers/status transitions.
- Restrict admin access with authentication, authorization, audit logging, and secure session handling.
- Do not log full card numbers, CVV, API keys, passwords, or webhook secrets.
- Use HTTPS for all customer and provider traffic.
- Do not claim "No KYC required" until issuer/provider rules and applicable legal requirements are verified.

## Provider constraints and unresolved items
- Kripicard documentation supplied to the project describes card creation as Mastercard issuance. Visa availability and its supplier/issuance route remain unconfirmed; do not offer Visa as available until verified.
- Kripicard API details and balance responses may be pending or unknown. Display unknown/pending balance states accurately; never substitute zero for an unknown balance.
- The supplied Kripicard card-details endpoint accepts provider card_id (preferred) or last4, not a full PAN. Customer PAN lookup must be implemented through a protected internal mapping, or replaced by a safer provider-supported identifier if available.
- Flutterwave webhook signature and payment verification details must be implemented against the current official provider documentation before production.
- Database connection values are deployment configuration, not source code. Use MYSQL_HOST, MYSQL_DATABASE, MYSQL_USER, MYSQL_PASSWORD.
- The currently exposed database, Kripicard, FTP, and SFTP credentials must be rotated before production use.

## Change control
Any change to an approved business rule, provider, pricing, fulfilment policy, card network, or customer flow requires CTO approval and an update to the relevant specification and decision log.
