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
- Customer checkout creates an order, sends a six-digit email OTP, verifies ownership, and only then allows Flutterwave initialization.
- Customer order status and history require a 30-day HttpOnly, SameSite=Strict customer session established by OTP verification. Order UUIDs alone do not authorize order access.
- Admin console: /admin. API endpoints are under /api/admin/* and require an authenticated staff session. The web server must serve the SPA index.html for direct navigation to /admin as well as /.

- Admin sessions use a 12-hour HttpOnly, SameSite=Strict cookie and CSRF token. Production cookies are Secure. Login is limited to five attempts per 15 minutes per source.
- Roles: admin can manage pricing and read audit logs; operations can manage order manual-review flags; support can view operational data. All roles can view orders and dashboard metrics.
- Manual review flags do not cancel or retry provider issuance. Provider polling continues and will not overwrite an order's manual-review state.
- Admin users are created through the one-time bootstrap command; never expose bootstrap credentials in source control or retain them in the runtime environment.

## Provider settings
- Set APP_ENCRYPTION_KEY to a securely generated base64-encoded 32-byte key in protected server environment configuration before applying migration 004_provider_settings.sql or saving provider credentials.
- Keep a protected backup of the encryption key. Do not put it in .env files that are served publicly, source control, or chat.
- Admin > Providers is restricted to the admin role. Configure credentials through the authenticated console; existing values are never displayed.
- Flutterwave verification uses its read-only NGN balance endpoint; SMTP verification uses TLS with certificate validation. Kripicard connection verification is intentionally unavailable until its supplied documentation defines a non-issuing check.
- Apply the migration as part of a reviewed versioned release. Do not apply migrations to production as an unreviewed ad hoc action.

## Release checklist
1. Obtain CTO approval for the release target and production activation.
2. Install dependencies from the lockfile.
3. Run typecheck, tests, and production build.
4. Apply reviewed database migrations with a least-privilege account using npm run migrate --workspace @cards/api (includes migration 005_customer_email_ownership.sql).
5. Create the first administrator once: set ADMIN_EMAIL, ADMIN_DISPLAY_NAME, and a unique ADMIN_PASSWORD (12+ characters) in a protected environment, then run npm run bootstrap-admin --workspace @cards/api. Remove the bootstrap variables immediately afterward. Verify /admin login and remove or rotate the account if bootstrap was run in error.
6. Configure production environment secrets securely, including SMTP_HOST, SMTP_PORT=587, SMTP_USER, SMTP_PASSWORD, and SMTP_FROM. Port 587 requires STARTTLS with certificate verification. Run `npm run smtp:verify --workspace @cards/api` from the release directory to verify the connection.
7. Configure HTTPS and the Flutterwave webhook URL: https://cards.raaduns.com/webhooks/flutterwave
8. Configure the production reverse proxy and process supervisor in FastPanel.
9. Configure a scheduled POST to /api/internal/kripicard/poll using the internal job secret.
10. Smoke-test health endpoint and customer/admin access controls.
11. Deploy to a versioned release directory and retain rollback target.

## Not yet production-ready
Customer email ownership and OTP-gated order access are implemented in the development branch but have not been deployed or migrated in production. Customer card management, protected balance lookup, card-delivery notifications, and the secure card-secret delivery design remain outstanding. Admin console is also not deployed or migrated in production. Do not enable public sales until these customer and operational flows are completed, configured, and reviewed.