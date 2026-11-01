ALTER TABLE issued_cards
  ADD COLUMN name_on_card VARCHAR(26) NULL,
  ADD COLUMN bin VARCHAR(6) NULL,
  ADD COLUMN provider_reference VARCHAR(120) NULL,
  MODIFY COLUMN issuance_status ENUM('queued','issuing','pending','active','failed','manual_review','refunded') NOT NULL DEFAULT 'queued',
  ADD UNIQUE KEY uq_issued_card_order_provider (order_id, provider);
