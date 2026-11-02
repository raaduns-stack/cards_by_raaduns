ALTER TABLE pricing_settings
  ADD COLUMN exchange_rate_ngn_per_usd DECIMAL(14,4) NOT NULL DEFAULT 1430.0000,
  ADD COLUMN issuance_fee_usd DECIMAL(12,2) NOT NULL DEFAULT 7.00,
  ADD COLUMN gross_profit_ngn DECIMAL(14,2) NOT NULL DEFAULT 10000.00,
  MODIFY COLUMN currency CHAR(3) NOT NULL DEFAULT 'NGN';

ALTER TABLE orders
  ADD COLUMN card_amount_usd DECIMAL(12,2) NULL AFTER amount,
  ADD COLUMN payment_currency CHAR(3) NOT NULL DEFAULT 'USD' AFTER card_amount_usd,
  ADD COLUMN payment_amount_ngn DECIMAL(14,2) NULL AFTER payment_currency,
  ADD COLUMN issuance_fee_usd_snapshot DECIMAL(12,2) NULL AFTER payment_amount_ngn,
  ADD COLUMN exchange_rate_snapshot DECIMAL(14,4) NULL AFTER issuance_fee_usd_snapshot,
  ADD COLUMN gross_profit_ngn_snapshot DECIMAL(14,2) NULL AFTER exchange_rate_snapshot;

-- Preserve prior checkout terms. Reprice only unstarted USD orders with no payment attempt.
UPDATE orders o
LEFT JOIN (SELECT order_id, COUNT(*) AS attempt_count FROM payment_attempts GROUP BY order_id) pa ON pa.order_id = o.id
SET card_amount_usd = CASE WHEN o.currency = 'USD' THEN o.amount ELSE NULL END,
    payment_currency = CASE
      WHEN o.currency = 'USD' AND o.payment_status = 'pending'
       AND COALESCE(pa.attempt_count, 0) = 0
      THEN 'NGN' ELSE o.currency END,
    payment_amount_ngn = CASE
      WHEN o.currency = 'USD' AND o.payment_status = 'pending'
       AND COALESCE(pa.attempt_count, 0) = 0
      THEN ROUND((o.amount + 7.00) * 1430.0000 + 10000.00, 2)
      WHEN o.currency = 'NGN' THEN o.amount
      ELSE NULL END,
    issuance_fee_usd_snapshot = CASE
      WHEN o.currency = 'USD' AND o.payment_status = 'pending'
       AND COALESCE(pa.attempt_count, 0) = 0
      THEN 7.00 ELSE NULL END,
    exchange_rate_snapshot = CASE
      WHEN o.currency = 'USD' AND o.payment_status = 'pending'
       AND COALESCE(pa.attempt_count, 0) = 0
      THEN 1430.0000 ELSE NULL END,
    gross_profit_ngn_snapshot = CASE
      WHEN o.currency = 'USD' AND o.payment_status = 'pending'
       AND COALESCE(pa.attempt_count, 0) = 0
      THEN 10000.00 ELSE NULL END,
    amount = CASE
      WHEN o.currency = 'USD' AND o.payment_status = 'pending'
       AND COALESCE(pa.attempt_count, 0) = 0
      THEN ROUND((o.amount + 7.00) * 1430.0000 + 10000.00, 2)
      ELSE o.amount END,
    currency = CASE
      WHEN o.currency = 'USD' AND o.payment_status = 'pending'
       AND COALESCE(pa.attempt_count, 0) = 0
      THEN 'NGN' ELSE o.currency END
WHERE o.card_amount_usd IS NULL;

UPDATE pricing_settings
SET currency = 'NGN', exchange_rate_ngn_per_usd = 1430.0000,
    issuance_fee_usd = 7.00, gross_profit_ngn = 10000.00
WHERE id = 1;