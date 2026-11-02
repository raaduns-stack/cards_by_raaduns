# Decision Log

## 2026-11-02 — Customer-facing Buy page simplification and approved claim
**Decision owner:** CTO  
**Status:** Approved

- Publish the headline “Get Your Virtual Card Instantly”.
- Publish the supporting claim “NO KYC REQUIRED”.
- Remove email verification/login as the initial landing-page gate. Customers must be able to view denominations and select a product before providing their email as part of order creation.
- Display Mastercard and Visa card imagery.
- Fixed denominations remain USD 20, 30, 50, 100, 150, and 200.
- Visa is visual-only/coming soon and must not be purchasable until a supplier and issuance route are secured, technically verified, and activation is approved.
- Update all relevant source-of-truth, specification, and security documentation to reflect this decision.

**Implementation constraint:** The approved marketing claim does not authorize bypassing issuer/provider conditions or applicable legal requirements. No Visa order or issuance is permitted before its provider gate is cleared.
