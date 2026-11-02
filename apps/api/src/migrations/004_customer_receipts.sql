CREATE TABLE IF NOT EXISTS email_outbox (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  order_id CHAR(36) NOT NULL,
  notification_type VARCHAR(40) NOT NULL,
  recipient VARCHAR(254) NOT NULL,
  subject VARCHAR(255) NOT NULL,
  text_body TEXT NOT NULL,
  html_body MEDIUMTEXT NULL,
  status ENUM('pending','sending','sent') NOT NULL DEFAULT 'pending',
  attempts INT UNSIGNED NOT NULL DEFAULT 0,
  last_error TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  sent_at DATETIME NULL,
  UNIQUE KEY uq_email_outbox_order_type (order_id, notification_type),
  INDEX idx_email_outbox_status (status, updated_at)
) ENGINE=InnoDB;