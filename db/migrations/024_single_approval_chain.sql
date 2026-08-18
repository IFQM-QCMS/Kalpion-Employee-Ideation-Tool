-- ============================================================================
--  024  One approval chain, not four descriptions of it
--
--    Master registry:
--      mysql -u root -p ifqm_master < db/migrations/024_single_approval_chain.sql
--    Then, FOR EACH TENANT DATABASE (the same file — it is written to be safe
--    against both schemas):
--      mysql -u root -p ifqm_<slug> < db/migrations/024_single_approval_chain.sql
--
--  ── What this removes and why ──────────────────────────────────────────────
--
--  The approval chain was stored four ways at once:
--
--    approval_mode                   'default' | 'custom' | 'stages'
--    approval_reviewer_roles         a role CSV, used only in 'custom'
--    approval_final_approver_roles   a role CSV, used only in 'custom'
--    approval_stages                 an ordered step list, used only in 'stages'
--    approval_threshold              a percentage, applied in every mode
--
--  Three of them described the same journey and disagreed about it. The
--  built-in 'default' chain named five reviewer roles; the stage list that sat
--  beside it named two; whichever was not in force still rendered its own
--  preview on the settings screen. An org admin reading that screen was shown
--  the same job titles two or three times over, in controls that looked alike
--  and meant different things, with no indication of which one their ideas
--  actually followed.
--
--  `approval_stages` survives because it is the only one of the four that
--  records an ORDER, which is what an approval chain is.
--
--  ── The threshold ──────────────────────────────────────────────────────────
--
--  approval_threshold set what share of a review committee had to approve. It
--  is removed rather than defaulted: it was a second, competing answer to "who
--  has to agree", it was read from the org config in one mode and from a
--  snapshot on the idea row in the others, and every organisation on the
--  platform had it at 100%. Committees are now unanimous by definition.
--
--  ideas.approval_threshold (the per-idea snapshot column) is deliberately NOT
--  dropped. It is the record of how already-decided ideas were judged, and an
--  approval history that quietly rewrites itself is worse than an unused
--  column. Nothing reads or writes it any more.
-- ============================================================================

-- Tenant databases keep the chain in org_settings.
SET @has_org := (SELECT COUNT(*) FROM information_schema.TABLES
                  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'org_settings');
SET @sql := IF(@has_org > 0,
  'DELETE FROM org_settings WHERE key_name IN
     (''approval_mode'', ''approval_reviewer_roles'',
      ''approval_final_approver_roles'', ''approval_threshold'')',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- Every tenant needs a chain to fall back on. Anything with no approver step
-- stored would drop to the built-in sequence at runtime anyway; writing it
-- makes the settings screen show the truth on first open.
SET @sql := IF(@has_org > 0,
  'INSERT INTO org_settings (key_name, value)
     VALUES (''approval_stages'', ''originator,immediate_manager,department_manager,plant_head'')
     ON DUPLICATE KEY UPDATE value = value',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- The master registry keeps the same keys as new-tenant defaults.
SET @has_plat := (SELECT COUNT(*) FROM information_schema.TABLES
                   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'platform_settings');
SET @sql := IF(@has_plat > 0,
  'DELETE FROM platform_settings WHERE key_name IN
     (''approval_mode'', ''approval_reviewer_roles'',
      ''approval_final_approver_roles'', ''approval_threshold'')',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql := IF(@has_plat > 0,
  'INSERT INTO platform_settings (key_name, value)
     VALUES (''approval_stages'', ''originator,immediate_manager,department_manager,plant_head'')
     ON DUPLICATE KEY UPDATE value = value',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
