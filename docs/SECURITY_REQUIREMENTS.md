# Security Requirements

## Credentials
- Never store secrets in source control, build output, browser bundles, logs, or documentation.
- Load provider, database, mail, and session secrets from server-side environment variables or a managed secret store.
- All credentials disclosed in chat are considered compromised and must be rotated before production use.
- Use separate credentials for development, staging, and production.
- Restrict file permissions on environment files and never serve them from the web root.

## Admin-managed provider credentials
- Provider credentials stored in the database must use AES-256-GCM with a unique random 96-bit IV per encryption and authenticated ciphertext.
- APP_ENCRYPTION_KEY must be a protected, base64-encoded 32-byte key outside source control and outside the web root. Back it up through the approved secret-management process; loss of the key makes stored credentials unrecoverable.
- API reads return configuration status only. Never return decrypted credentials, even to administrators; credential fields are write-only and blank submissions retain existing values.
- Audit only provider name, changed field names, environment and verification outcome. Never audit credential contents.
- Connection checks must be non-transactional. Never create a card or initiate a charge as a credential test.

## Card data
- Do not log PAN, CVV, expiry, API keys, or authentication secrets.
- Minimize card-data retention. Prefer provider card IDs or tokenized identifiers over storing full PAN.
- If full PAN is accepted for a balance lookup, transmit only over HTTPS, avoid persistence, redact it from logs/traces, and use a protected internal mapping to the provider card ID. Review PCI DSS scope before production.
- Never expose CVV or full card details in admin lists or ordinary logs.
- Unknown provider balance must remain unknown, not display as zero.

## Payments and webhooks
- Verify payment server-side with provider verification APIs and signed webhooks.
- Verify webhook signatures using the exact official provider scheme and raw request body as required.
- Persist event IDs and process each event idempotently.
- Reject invalid signatures and malformed/unexpected event payloads.
- Do not mark an order paid based solely on frontend redirects or client-supplied status.
- Protect webhook endpoints against replay where the provider contract supports timestamps/nonces.

## Customer email OTP authentication
- Generate cryptographically random six-digit codes; store only salted password-hard KDF hashes, never plaintext codes.
- Enforce ten-minute expiry, single-use semantics, bounded attempts, and request/verification rate limits.
- Use constant-time hash comparison, rotate session tokens, store only token hashes, and use HttpOnly, SameSite=Strict, Secure-in-production cookies plus CSRF validation for state-changing requests.
- Derive customer email from the authenticated session, not the order request body. Enforce customer_id ownership in every customer order, payment-initialization, card, and balance endpoint.
- Never allow an order UUID or email address alone to authorize access. Link historical orders only after successful verification of the matching email.

## Application security
- Enforce staff role-based authorization on every admin endpoint.
- Use secure password hashing, session rotation, CSRF protection where cookie sessions are used, rate limiting, and secure cookie flags.
- Validate and normalize all inputs server-side.
- Apply least-privilege database credentials and parameterized queries.
- Maintain audit records for pricing, order, fulfilment, and staff actions.
- Use HTTPS and security headers.
- Do not publish a "No KYC required" claim until confirmed by issuer/provider and applicable requirements.