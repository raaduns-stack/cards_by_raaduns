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
