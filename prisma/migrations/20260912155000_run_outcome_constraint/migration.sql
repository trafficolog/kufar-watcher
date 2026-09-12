ALTER TABLE "Run"
ADD CONSTRAINT "Run_outcome_supported_check"
CHECK ("outcome" IN ('running', 'success', 'catchup', 'skipped', 'error', 'interrupted'))
NOT VALID;
