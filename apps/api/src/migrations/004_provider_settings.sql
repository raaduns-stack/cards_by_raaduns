CREATE TABLE IF NOT EXISTS provider_settings (
  provider ENUM('flutterwave','kripicard','smtp') NOT NULL PRIMARY KEY,
  encrypted_config MEDIUMTEXT NOT NULL,
  environment ENUM('test','live','production') NOT NULL DEFAULT 'production',
  verification_status ENUM('not_tested','verified','failed') NOT NULL DEFAULT 'not_tested',
  last_verified_at DATETIME NULL,
  configured_by BIGINT UNSIGNED NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_provider_settings_admin FOREIGN KEY (configured_by) REFERENCES admin_users(id) ON DELETE SET NULL
) ENGINE=InnoDB;