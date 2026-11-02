# Project Specification

## Objective
Build a web application for purchasing and receiving virtual payment cards, with a customer portal and an authenticated administration area.

## Customer journey
1. Customer selects a card product/network that is actually available.
2. Customer selects one of the configured fixed denominations (USD 20, 30, 50, 100, 150, 200) or enters a custom amount from USD 20 to USD 500 in USD 1 increments (CTO-approved).
3. Customer provides an email address and submits the order.
4. Backend creates a pending order and requests payment instructions from Flutterwave.
5. Customer completes payment using the instructions presented by the application.
6. Backend confirms payment with Flutterwave using verified server-side evidence.
7. Customer receives a payment confirmation email.
8. Fulfilment runs through Kripicard API by default. Staff manually handles exceptions through the admin area.
9. Once card details are available and validated, the application securely stores/associates the provider card record and emails delivery instructions/details to the customer.

## Customer authentication (CTO-approved 2026-11-01)
- Customers authenticate with a six-digit, email-delivered one-time code; no password account is required.
- Codes expire after 10 minutes, are single-use, and are limited to five verification attempts. Requests are rate-limited per source and per email.
- Successful verification creates/uses a customer identity keyed by normalized email and establishes a seven-day server-side session with an HttpOnly cookie and CSRF token.
- Existing unclaimed orders with the same email are associated only after the customer proves control of that email. New orders require an authenticated customer session and are linked to that customer ID.
- Customer order/status APIs must filter by authenticated customer ID. A UUID alone is never authorization.

## Customer areas
- Buy Card: network/product selection, fixed denominations, custom amount, email, order creation.
- Payment: provider-generated payment instructions and payment status.
- My Card: list cards associated with the customer's verified order/email and delivery status.
- Check Balance: customer enters card number; backend securely maps it to an internal card record and queries the provider. Do not send provider API credentials to the client.
- Order status and email notifications.

## Admin areas
- Dashboard and operational metrics.
- Orders and payment status.
- Fulfilment queue, including API retries/status tracking and manual exception fulfilment.
- Customers and order/card associations.
- Card product/network availability.
- Pricing configuration: enable/disable fixed denominations and configure custom amount minimum/maximum/step/currency rules.
- Email delivery history and operational logs.
- Staff accounts, roles, and audit trail.
- Provider configuration/status without exposing secret values. Admin-only write-once/replace credential fields for Flutterwave, Kripicard and SMTP; encrypted storage and auditable changes.

## Fulfilment
- API fulfilment is the default.
- Staff handles exceptions, including provider rejection, unavailable network/BIN, manual review, and operational failures.
- Do not blindly retry card creation after a provider response indicating the request is pending/queued or that the customer has been charged. Track provider reference/order ID and poll request status according to the provider contract.
- Visa availability is unconfirmed. Do not expose Visa as purchasable until the CTO confirms an issuance source and the integration is verified.
- The supplied Kripicard create-card documentation describes Mastercard issuance. Do not infer Visa issuance support from card-list examples.

## Payments and notifications
- Flutterwave supplies payment instructions.
- A browser redirect or client-side success message is not proof of payment.
- Backend must verify the transaction and process provider webhooks idempotently.
- Send payment confirmation only after server-side verification.
- Send card delivery email only after fulfilment details are available and checked.
- Never include CVV or full PAN in application logs or general-purpose email templates. Delivery channel and PCI/security requirements require a separate security review before sending sensitive card credentials.

## Configuration
- Database: MySQL.
- Required environment variables include MYSQL_HOST, MYSQL_DATABASE, MYSQL_USER, MYSQL_PASSWORD, KRIPICARD_API_KEY, Flutterwave credentials, application URL, session secrets, and mail transport settings.
- CTO supplied non-secret MySQL identifiers: host localhost, database cardsbyraaduns, user cardsbyraad_usr. Password must be rotated and installed server-side; do not store it in Git.
- Webhook routes:
  - POST /webhooks/flutterwave
  - POST /webhooks/kripicard

## Open decisions / blockers
- Visa supplier and verified issuance route.
- Custom amount is CTO-approved at USD 20 minimum, USD 500 maximum, and USD 1 increments; server-side validation is mandatory.
- Flutterwave product/method and exact provider configuration.
- Kripicard production API key rotation and environment installation.
- Secure customer authentication/ownership verification for My Card and balance checking.
- Safe card-secret delivery and storage design.
- Hosting database password rotation and server-side configuration.
- Exact KYC/issuer eligibility language; "No KYC required" is not approved for publication.
## Approved pricing and checkout currency (CTO-confirmed 2026-11-01)
- Customer-facing card denominations and custom amounts are USD face values.
- Customer checkout and Flutterwave charge currency is NGN.
- Default pricing inputs: USD 7.00 issuance fee per card, NGN 1,430.00/USD exchange rate, and NGN 10,000.00 gross profit per card.
- Formula: `NGN charge = ((USD card face value + USD issuance fee) × NGN/USD exchange rate) + NGN gross profit`.
- USD 20 example: NGN 48,610.00.
- Pricing inputs are editable only by an administrator in Admin → Pricing. The page must show example NGN prices for configured fixed denominations and explain that gross profit is before payment fees, tax, refunds, and other operating costs.
- The customer must see the NGN charge before starting Flutterwave checkout. Custom amount price previews may be calculated in the browser, but the server-calculated order quote is authoritative.
- Persist a per-order snapshot of card face value, fee, exchange rate, profit, NGN amount and currency. Do not reprice an existing order after settings change.
- Flutterwave initialization and server-side verification use the stored NGN amount/currency. Kripicard card creation uses only the stored USD face value, never the NGN charge.