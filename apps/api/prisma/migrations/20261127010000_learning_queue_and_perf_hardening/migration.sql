ALTER TABLE "users" ADD COLUMN "avatar_updated_at" TIMESTAMPTZ(6);

UPDATE "users" SET "avatar_updated_at" = "updated_at" WHERE "avatar_data" IS NOT NULL;

ALTER TABLE "threat_feedback_examples"
  ADD COLUMN "source_channel" VARCHAR(20) NOT NULL DEFAULT 'ADMIN',
  ADD COLUMN "review_status" VARCHAR(20) NOT NULL DEFAULT 'APPROVED',
  ADD COLUMN "reporter_session_hash" VARCHAR(64),
  ADD COLUMN "assessment" VARCHAR(16);

CREATE INDEX "threat_feedback_examples_review_status_source_channel_creat_idx" ON "threat_feedback_examples" ("review_status", "source_channel", "created_at");

CREATE INDEX "threat_feedback_examples_audit_id_reporter_session_hash_idx" ON "threat_feedback_examples" ("audit_id", "reporter_session_hash");

CREATE INDEX "threat_feedback_examples_reporter_session_hash_created_at_idx" ON "threat_feedback_examples" ("reporter_session_hash", "created_at");

CREATE INDEX "forensic_audits_user_id_created_at_idx" ON "forensic_audits" ("user_id", "created_at");

CREATE INDEX "forensic_audits_guest_session_id_created_at_idx" ON "forensic_audits" ("guest_session_id", "created_at");

CREATE INDEX "calculation_sessions_user_id_created_at_idx" ON "calculation_sessions" ("user_id", "created_at");

CREATE INDEX "calculation_sessions_guest_session_id_created_at_idx" ON "calculation_sessions" ("guest_session_id", "created_at");

CREATE INDEX "market_article_feed_status_published_at_idx" ON "market_article" ("feed_status", "published_at");

CREATE INDEX "market_article_content_hash_idx" ON "market_article" ("content_hash");

CREATE INDEX "article_impact_analyses_article_id_analysis_mode_profile_id_idx" ON "article_impact_analyses" ("article_id", "analysis_mode", "profile_id", "created_at");

CREATE INDEX "threat_alert_verification_status_published_at_idx" ON "threat_alert" ("verification_status", "published_at");

CREATE INDEX "threat_alert_origin_source_created_at_idx" ON "threat_alert" ("origin_source", "created_at");

CREATE INDEX "threat_indicator_indicator_type_indicator_text_idx" ON "threat_indicator" ("indicator_type", "indicator_text");

CREATE INDEX "threat_indicator_threat_alert_id_idx" ON "threat_indicator" ("threat_alert_id");
