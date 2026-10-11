CREATE TABLE IF NOT EXISTS shpun_fx_history (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  source VARCHAR(32) NOT NULL,
  effective_date DATE NOT NULL,
  fetched_at DATETIME NOT NULL,
  fingerprint CHAR(64) NOT NULL,
  payload JSON NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_shpun_fx_fingerprint (fingerprint),
  KEY idx_shpun_fx_effective_date (effective_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
