# AGENTS.md

## Authority
- Read docs/SOURCE_OF_TRUTH.md before making changes.
- Read the relevant project specification, architecture, and security documents before implementing a feature.
- CTO-approved decisions are authoritative. Do not silently change product rules, providers, pricing, fulfilment, or supported card networks.
- If a requirement is ambiguous or a decision changes scope, present concise options and request CTO direction.

## Engineering rules
- TypeScript strict mode for application code.
- Keep provider integrations behind server-side adapters.
- Never expose API keys, database passwords, webhook secrets, or card secrets to frontend code.
- Never commit .env files or real credentials. Maintain .env.example with placeholders only.
- Verify payment on the backend; webhook handlers must be signature-verified and idempotent.
- Do not retry provider operations that may already have charged/issued a card. Persist provider references and check request status.
- Treat unknown card balances as unknown, never zero.
- Do not enable Visa until its supplier and issuance path are confirmed.
- Add migrations for database schema changes.
- Add tests for business rules, payment verification, webhook idempotency, fulfilment state transitions, and authorization.
- Do not deploy to production or run live card/payment transactions without explicit CTO approval.
- Keep changes small, reviewable, and documented. Update decision/specification docs when CTO decisions change.
