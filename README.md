# Cards by Raaduns

Virtual card ordering and fulfilment application.

## Stack
- React frontend
- Node.js 22 + TypeScript API
- MySQL
- Flutterwave payments
- Kripicard Mastercard issuance

## Project authority
Read docs/SOURCE_OF_TRUTH.md, docs/PROJECT_SPECIFICATION.md, docs/SYSTEM_ARCHITECTURE.md, docs/SECURITY_REQUIREMENTS.md, and AGENTS.md before development.

## Current implementation
The development/bootstrap branch contains:
- Database-backed card catalogue and approved fixed denominations.
- Order creation and server-side amount validation.
- Flutterwave checkout initialization and signed webhook transaction verification.
- Kripicard Mastercard issuance after verified payment, including pending-issuance tracking and a protected status-poll endpoint.
- Storefront checkout connected to the catalogue, order API, and Flutterwave redirect.

The branch has passed npm run typecheck and npm run build on the server's temporary verification clone. It has not been deployed to the production web root.

## Remaining implementation
- Admin authentication, roles, pricing management, and operational screens.
- Customer account/order ownership and card management.
- Balance lookup using a protected internal card mapping.
- Email notifications and approved card-secret delivery design.
- Kripicard webhook handling, if/when the provider supplies a documented event contract.
- Automated scheduled polling for pending Kripicard issuance.

## Security
Never commit real credentials. Configure the application using server-side environment variables. Do not log or expose full card numbers, CVV, expiry, provider keys, passwords, or webhook secrets.
