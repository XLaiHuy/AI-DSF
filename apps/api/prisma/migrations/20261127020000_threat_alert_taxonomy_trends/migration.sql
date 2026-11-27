ALTER TABLE "threat_alert"
  ADD COLUMN "vn_ais_code" VARCHAR(20),
  ADD COLUMN "gasa_category" VARCHAR(40),
  ADD COLUMN "target_audience" VARCHAR(30);

CREATE INDEX "threat_alert_status_published_ais_idx"
  ON "threat_alert" ("verification_status", "published_at", "vn_ais_code");
