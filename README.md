# Cards by Raaduns

Virtual card ordering and fulfilment application.

## Stack
- React customer/admin frontend (Vite)
- Node.js 22 + TypeScript API
- MySQL
- Flutterwave payments
- Kripicard card issuance and card services

## Customer frontend
The React application source is in `src/`. Build with `npm install && npm run build`; Vite writes the static production bundle to `dist/`. The frontend calls the same-origin API and contains no provider credentials.

The Buy page loads live denominations and NGN prices from `GET /api/catalog`. Customers can browse and select before email authentication. Email sign-in code is requested only after they submit the selected amount and email; the verified session is then used for order creation and Flutterwave payment initialization.

Visa artwork is illustrative and labelled coming soon. Visa checkout remains disabled until its supplier and issuance route are verified and CTO activation is approved.

## Project authority
Read [docs/SOURCE_OF_TRUTH.md](docs/SOURCE_OF_TRUTH.md), [docs/PROJECT_SPECIFICATION.md](docs/PROJECT_SPECIFICATION.md), [docs/SYSTEM_ARCHITECTURE.md](docs/SYSTEM_ARCHITECTURE.md), [docs/SECURITY_REQUIREMENTS.md](docs/SECURITY_REQUIREMENTS.md), and [AGENTS.md](AGENTS.md) before development.

## Security
Never commit real credentials. Configure the application using server-side environment variables. Rotate any credentials that have been disclosed in chat before production use.

## Status
Customer React frontend rebuilt against the existing same-origin catalog, customer email OTP, order, and Flutterwave initialization endpoints.
