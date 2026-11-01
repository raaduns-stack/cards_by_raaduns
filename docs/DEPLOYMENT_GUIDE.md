# Deployment Guide

## Current server state
- Host: mail.quicrefill.com (173.249.47.219).
- Web root: /var/www/raaduns_com_usr/data/www/cards.raaduns.com.
- The web root currently contains a hosting placeholder and is not a Git checkout.
- Runtime inspection found Node.js 22.23.3, PHP 7.4.3, and Composer 2.8.5. The application is approved for Node.js 22; PHP is not the application runtime.
- The application has been built and typechecked in /tmp/cards-bootstrap-verify. This is a verification clone, not the production web root.

## Deployment safety
- Do not overwrite the current web root until a tested release and rollback plan exist.
- Build and validate in a separate release/staging directory.
- Configure process supervision and reverse proxy through the hosting control panel; do not manually alter managed Nginx/Apache configuration.
- Keep secrets outside the repository and outside any publicly served directory.
- Configure MYSQL_HOST, MYSQL_PORT, MYSQL_DATABASE, MYSQL_USER, MYSQL_PASSWORD, KRIPICARD_API_KEY, KRIPICARD_BIN, INTERNAL_JOB_SECRET, FLUTTERWAVE_SECRET_KEY, FLUTTERWAVE_WEBHOOK_SECRET, APP_URL, and mail settings in the server environment.
- The CTO-provided database host/name/user are localhost / cardsbyraaduns / cardsbyraad_usr.
- Do not run live card issuance, real payment transactions, or production webhook tests without explicit CTO approval.

## Current integration behavior
- Flutterwave webhook: POST /webhooks/flutterwave. The backend validates the configured webhook hash and independently verifies the transaction before changing payment state.
- Kripicard issuance starts only after verified payment. The default configurable BIN is 539502; set KRIPICARD_BIN to override it.
- Provider HTTP 202 / ISSUANCE_PENDING responses are stored as pending. The implementation does not issue a duplicate card; it tracks the provider reference/order ID and polls request status.
- Pending issuance polling endpoint: POST /api/internal/kripicard/poll. It requires the x-job-secret header matching INTERNAL_JOB_SECRET. Schedule it through the hosting cron facility after deployment.
- The supplied Kripicard documentation does not define a webhook event contract. Do not invent one; pending issuance is reconciled through the documented Request Status endpoint.
- The customer storefront calls /api/catalog, /api/orders, and /api/payments/flutterwave/initialize. The production reverse proxy must route /api and /webhooks to the Node API.
- The customer callback URL includes the order UUID as a bearer status reference. The status response does not include the customer's email address.

## Release checklist
1. Obtain CTO approval for the release target and production activation.
2. Install dependencies from the lockfile.
3. Run typecheck, tests, and production build.
4. Apply reviewed database migrations with a least-privilege account using npm run migrate --workspace @cards/api.
5. Configure production environment secrets securely.
6. Configure HTTPS and the Flutterwave webhook URL: https://cards.raaduns.com/webhooks/flutterwave
7. Configure the production reverse proxy and process supervisor in FastPanel.
8. Configure a scheduled POST to /api/internal/kripicard/poll using the internal job secret.
9. Smoke-test health endpoint and customer/admin access controls.
10. Deploy to a versioned release directory and retain rollback target.

## Not yet production-ready
Admin authentication, customer account ownership, balance lookup, email notifications, and the secure card-secret delivery design are not implemented. Do not enable public sales until these customer and operational flows are completed and reviewed.
