# Project Specification

## Objective
Build a web application for purchasing and receiving virtual payment cards, with a simple customer purchase journey and an authenticated administration area.

## Customer landing page
The first viewport of the Buy page must contain only the following primary content:
1. Bold headline: **Get Your Virtual Card Instantly**
2. Bold supporting claim: **NO KYC REQUIRED**
3. Mastercard and Visa card imagery.
4. The fixed USD denomination choices: **$20, $30, $50, $100, $150, $200**.

Do not show a login panel, email OTP form, lengthy introduction, or payment/fulfilment disclaimers above the product selection. Supporting UI labels and controls should be visually subordinate; avoid additional bold marketing copy.

Visa card imagery is permitted as a visual placeholder/promotional representation. Visa must be clearly marked unavailable/coming soon and must not be selectable for purchase until a Visa supplier and issuance route are verified, integrated, and approved by the CTO. Mastercard remains the currently documented purchasable network.

## Customer journey
1. Customer lands on the Buy page and sees the approved headline, KYC statement, card imagery, and available denominations.
2. Customer chooses an available card network. Only verified purchasable networks may be selected; Visa remains visual-only/coming soon until its provider gate is cleared.
3. Customer selects one of the configured fixed denominations (USD 20, 30, 50, 100, 150, 200) or enters a custom amount within administrator-configured limits.
4. Customer provides an email address as part of order creation. Email OTP must not block browsing or denomination selection; if ownership verification is required, apply it to the relevant order/customer access step without adding friction to the landing page.
5. Backend creates a pending order and requests payment instructions from Flutterwave.
6. Customer completes payment using the instructions presented by the application.
7. Backend confirms payment with Flutterwave using verified server-side evidence.
8. Customer receives a payment confirmation email.
9. Fulfilment runs through Kripicard API by default. Staff manually handles exceptions through the admin area.
10. Once card details are available and validated, the application securely stores/associates the provider card record and emails delivery instructions/details to the customer.

## Customer areas
- Buy Card: available network/product selection, fixed denominations, custom amount, email, order creation.
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
- Provider configuration/status without exposing secret values.

## Fulfilment
- API fulfilment is the default.
- Staff handles exceptions, including provider rejection, unavailable network/BIN, manual review, and operational failures.
- Do not blindly retry card creation after a provider response indicating the request is pending/queued or that the customer has been charged. Track provider reference/order ID and poll request status according to the provider contract.
- Visa remains unavailable for purchase until its supplier, issuance route, integration, and CTO activation approval are complete.
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
- Visa supplier and verified issuance route; Visa must remain visual-only/coming soon until resolved.
- Admin-defined custom amount bounds and increment rules.
- Flutterwave product/method and exact provider configuration.
- Kripicard production API key rotation and environment installation.
- Secure customer authentication/ownership verification for My Card and balance checking.
- Safe card-secret delivery and storage design.
- Hosting database password rotation and server-side configuration.
