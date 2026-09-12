ALTER TABLE "Monitor"
ADD CONSTRAINT "Monitor_intervalSec_supported_check"
CHECK ("intervalSec" IN (60, 120, 300, 600, 900, 3600))
NOT VALID;
