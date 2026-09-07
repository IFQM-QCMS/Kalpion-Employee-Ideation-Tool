-- 021 Payment grace period, reminders, and Razorpay

INSERT IGNORE INTO platform_settings (key_name, value) VALUES
  -- Days after the due date before access is actually withdrawn.
  ('billing_grace_days',   '2'),
  -- At most one reminder per organisation per day, so a sweep that runs hourly does not send
  -- twelve.
  ('billing_reminder_hours', '20');

-- Razorpay Platform-wide: IFQM holds one merchant account and every organisation pays into
-- it.
INSERT IGNORE INTO platform_settings (key_name, value) VALUES
  ('razorpay_enabled',      '0'),
  -- rzp_test_... or rzp_live_.... Public by design: the checkout script needs it.
  ('razorpay_key_id',       ''),
  ('razorpay_key_secret',   ''),
  -- Shown on the Razorpay checkout window.
  ('razorpay_business_name','IFQM'),
  ('razorpay_last_test_at', ''),
  ('razorpay_last_test_ok', ''),
  ('razorpay_last_test_note', '');

-- When the last "your payment is overdue" reminder went out, so the sweep can be
-- idempotent about sending them.
SET @sql := IF((SELECT COUNT(*) FROM information_schema.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tenants'
                   AND COLUMN_NAME = 'last_reminder_at') = 0,
  'ALTER TABLE tenants ADD COLUMN last_reminder_at DATETIME NULL DEFAULT NULL', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- Payment attempts Every order raised and every outcome.
CREATE TABLE IF NOT EXISTS payment_attempts (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  tenant_id       INT          NOT NULL,
  plan_id         INT          NULL,
  -- Razorpay's order id (order_...) and, once paid, its payment id (pay_...).
  order_ref       VARCHAR(64)  NULL,
  payment_ref     VARCHAR(64)  NULL,
  -- Paise, always. The amount as it was quoted at the moment the order was raised: a later
  -- price change must not retroactively alter what somebody was charged.
  amount_paise    INT          NOT NULL DEFAULT 0,
  gst_paise       INT          NOT NULL DEFAULT 0,
  currency        VARCHAR(8)   NOT NULL DEFAULT 'INR',
  periods         INT          NOT NULL DEFAULT 1,
  status          ENUM('created','paid','failed','cancelled') NOT NULL DEFAULT 'created',
  -- Who pressed pay, for the audit trail.
  actor_email     VARCHAR(160) NULL,
  actor_name      VARCHAR(120) NULL,
  note            VARCHAR(500) NULL,
  created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  paid_at         DATETIME     NULL,
  UNIQUE KEY uq_order (order_ref),
  INDEX idx_pay_tenant (tenant_id, created_at),
  INDEX idx_pay_status (status, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
