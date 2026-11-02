# System Architecture

## Approved technology
- React customer/admin frontend.
- Node.js 22 + TypeScript backend.
- MySQL relational database.
- Flutterwave payment integration.
- Kripicard card issuance/status/balance integration.
- Background worker for asynchronous provider operations, webhook retries, and email delivery.

## Logical components
1. Web client: renders customer purchase, payment, card, balance, and admin experiences. Contains no provider secrets.
2. API server: validates requests, authenticates users/staff, owns business rules, persists state, and calls providers.
3. MySQL: stores users, orders, payment attempts, webhook event IDs, fulfilment jobs, provider references, card metadata, pricing configuration, email events, and audit events.
4. Provider adapters: isolate Flutterwave and Kripicard request/response handling and signature verification.
5. Worker: processes queued fulfilment, polls provider request status, sends notifications, and retries only operations known to be safe.
6. Email service: sends payment and card-delivery notifications using server-side credentials.

## Initial API boundaries
- POST /api/orders
- GET /api/orders/:orderId
- POST /api/payments/flutterwave/initialize
- POST /webhooks/flutterwave
- POST /webhooks/kripicard
- GET /api/cards
- POST /api/cards/balance-check
- Admin routes under /api/admin/*

These are proposed application routes; provider-specific payloads must follow verified official contracts.

## Data and state principles
- Order, payment, and fulfilment states are separate state machines.
- Payment status changes only after backend verification.
- Webhook event processing is idempotent.
- Provider request references and order IDs are persisted before polling.
- Pending/queued provider responses are not treated as final failure and must not trigger duplicate issuance.
- Card balance is nullable with source and timestamp metadata. Unknown is not zero.
- Audit administrative changes and manual fulfilment actions.

## Webhook routing
- Flutterwave: POST /webhooks/flutterwave
- Kripicard: POST /webhooks/kripicard
Each route has its own raw-body/signature verification strategy, event validation, replay protection where supported, idempotency key, and event log.

## Deployment
The configured web root is /var/www/raaduns_com_usr/data/www/cards.raaduns.com. The current directory contains only a hosting placeholder and is not a Git checkout. Deployment design must preserve the current placeholder until a tested release is ready. Secrets remain outside the repository.

## Multi-currency pricing boundary (CTO-confirmed 2026-11-01)
- `pricing_settings` stores the current NGN/USD exchange rate, USD issuance fee, NGN gross-profit target, and custom USD denomination rules.
- The order pricing snapshot separates `card_amount_usd` from `payment_amount_ngn` and stores `payment_currency`, `issuance_fee_usd_snapshot`, `exchange_rate_snapshot`, and `gross_profit_ngn_snapshot`.
- Order creation calculates the quote on the API from locked current settings. Monetary snapshots are immutable for the lifetime of the order.
- Flutterwave receives and verifies `payment_amount_ngn` in NGN. Kripicard receives `card_amount_usd` in USD.
- Frontend quote calculations are display-only; backend calculations and persisted snapshots are authoritative.

## Admin frontend architecture (CTO-approved 2026-11-02)
- The admin experience remains a React single-page application with a shared authenticated shell; separate URLs and page components are used for each admin area.
- Admin routes: `/admin` (dashboard), `/admin/orders`, `/admin/pricing`, `/admin/providers`, and `/admin/audit`.
- Each route is resolved independently and supports browser back/forward navigation and direct URL refresh through the existing web-server SPA fallback.
- Page components live under `apps/web/src/pages/admin/`; the shared admin shell owns session state, navigation, and cross-page API state.
- Provider settings use a provider selector and one focused configuration panel rather than rendering every provider form in a horizontal/stacked list.
- Provider field state is derived from server-returned configured-field metadata. Draft edits are shown separately as unsaved changes. Secret values remain write-only; the browser never receives decrypted credentials.
- Provider metadata must report configured optional fields such as Kripicard BIN and SMTP sender address so the UI does not mislabel persisted values as missing.