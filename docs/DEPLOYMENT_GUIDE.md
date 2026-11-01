# Deployment Guide

## Current server state
- Host: mail.quicrefill.com (173.249.47.219).
- Web root: /var/www/raaduns_com_usr/data/www/cards.raaduns.com.
- The web root currently contains a hosting placeholder and is not a Git checkout.
- Runtime inspection found Node.js 22.23.3, PHP 7.4.3, and Composer 2.8.5. The application is approved for Node.js 22; PHP is not the application runtime.

## Deployment safety
- Do not overwrite the current web root until a tested release and rollback plan exist.
- Build and validate in a separate release/staging directory.
- Configure process supervision and reverse proxy through the hosting control panel; do not manually alter managed Nginx/Apache configuration.
- Keep secrets outside the repository and outside any publicly served directory.
- Configure MYSQL_HOST, MYSQL_PORT, MYSQL_DATABASE, MYSQL_USER, MYSQL_PASSWORD, KRIPICARD_API_KEY, Flutterwave credentials, SESSION_SECRET, and mail settings in the server environment.
- The CTO-provided database host/name/user are localhost / cardsbyraaduns / cardsbyraad_usr. The password shared in chat must be rotated before configuration.
- Rotate all credentials disclosed in chat: MySQL password, Kripicard API key, FTP password, and SFTP password.
- Do not run live card issuance, real payment transactions, or production webhook tests without explicit CTO approval.

## Release checklist
1. Install dependencies from the lockfile.
2. Run typecheck, tests, and production build.
3. Apply reviewed database migrations with a least-privilege account.
4. Configure production environment secrets securely.
5. Configure HTTPS and provider webhook URLs:
   - https://cards.raaduns.com/webhooks/flutterwave
   - https://cards.raaduns.com/webhooks/kripicard
6. Verify webhook signature schemes against official provider documentation.
7. Smoke-test health endpoint and customer/admin access controls.
8. Deploy to a versioned release directory and retain rollback target.
