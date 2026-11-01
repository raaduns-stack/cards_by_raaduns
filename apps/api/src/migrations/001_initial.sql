CREATE TABLE IF NOT EXISTS card_products (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(40) NOT NULL UNIQUE,
  name VARCHAR(100) NOT NULL,
  network VARCHAR(20) NOT NULL,
  provider VARCHAR(40) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS pricing_settings (
  id TINYINT UNSIGNED NOT NULL PRIMARY KEY,
  currency CHAR(3) NOT NULL DEFAULT 'USD',
  custom_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  custom_min DECIMAL(12,2) NULL,
  custom_max DECIMAL(12,2) NULL,
  custom_step DECIMAL(12,2) NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT chk_custom_bounds CHECK (
    (custom_enabled = FALSE) OR
    (custom_min IS NOT NULL AND custom_max IS NOT NULL AND custom_step IS NOT NULL
     AND custom_min > 0 AND custom_max >= custom_min AND custom_step > 0)
  )
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS fixed_denominations (
  amount DECIMAL(12,2) NOT NULL PRIMARY KEY,
  is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order SMALLINT UNSIGNED NOT NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS orders (
  id CHAR(36) NOT NULL PRIMARY KEY,
  order_number VARCHAR(32) NOT NULL UNIQUE,
  product_id BIGINT UNSIGNED NOT NULL,
  customer_email VARCHAR(254) NOT NULL,
  currency CHAR(3) NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  order_status ENUM('pending_payment','paid','fulfilment_pending','fulfilled','cancelled','failed','manual_review') NOT NULL DEFAULT 'pending_payment',
  payment_status ENUM('pending','successful','failed','cancelled') NOT NULL DEFAULT 'pending',
  fulfilment_status ENUM('not_started','queued','processing','completed','failed','manual_review') NOT NULL DEFAULT 'not_started',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_orders_product FOREIGN KEY (product_id) REFERENCES card_products(id),
  INDEX idx_orders_email (customer_email),
  INDEX idx_orders_status (order_status, created_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS payment_attempts (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  order_id CHAR(36) NOT NULL,
  provider VARCHAR(30) NOT NULL DEFAULT 'flutterwave',
  provider_reference VARCHAR(120) NULL,
  provider_transaction_id VARCHAR(120) NULL,
  status ENUM('initialized','pending','successful','failed','cancelled') NOT NULL DEFAULT 'initialized',
  checkout_url TEXT NULL,
  raw_response JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_payment_order FOREIGN KEY (order_id) REFERENCES orders(id),
  UNIQUE KEY uq_payment_provider_reference (provider, provider_reference),
  INDEX idx_payment_order (order_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS webhook_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  provider VARCHAR(30) NOT NULL,
  event_id VARCHAR(190) NOT NULL,
  payload JSON NOT NULL,
  processing_status ENUM('received','processed','failed') NOT NULL DEFAULT 'received',
  received_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  processed_at TIMESTAMP NULL,
  UNIQUE KEY uq_webhook_provider_event (provider, event_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS issued_cards (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  order_id CHAR(36) NOT NULL,
  provider VARCHAR(30) NOT NULL,
  provider_card_id VARCHAR(120) NULL,
  provider_order_id VARCHAR(120) NULL,
  last4 CHAR(4) NULL,
  balance DECIMAL(12,2) NULL,
  balance_currency CHAR(3) NULL,
  balance_known BOOLEAN NOT NULL DEFAULT FALSE,
  balance_source VARCHAR(80) NULL,
  balance_as_of DATETIME NULL,
  issuance_status ENUM('queued','pending','active','failed','manual_review') NOT NULL DEFAULT 'queued',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_card_order FOREIGN KEY (order_id) REFERENCES orders(id),
  INDEX idx_card_provider_id (provider, provider_card_id),
  INDEX idx_card_last4 (last4)
) ENGINE=InnoDB;

INSERT IGNORE INTO card_products (code, name, network, provider, is_active)
VALUES ('virtual-mastercard', 'Virtual Mastercard', 'mastercard', 'kripicard', TRUE);

INSERT IGNORE INTO pricing_settings (id, currency, custom_enabled)
VALUES (1, 'USD', FALSE);

INSERT IGNORE INTO fixed_denominations (amount, is_enabled, sort_order)
VALUES (20.00, TRUE, 1), (30.00, TRUE, 2), (50.00, TRUE, 3),
       (100.00, TRUE, 4), (150.00, TRUE, 5), (200.00, TRUE, 6);
