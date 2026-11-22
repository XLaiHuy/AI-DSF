-- CreateTable
CREATE TABLE "schema_migrations" (
    "version" VARCHAR(100) NOT NULL,
    "description" VARCHAR(200) NOT NULL,
    "applied_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "schema_migrations_pkey" PRIMARY KEY ("version")
);

-- CreateTable
CREATE TABLE "market_source" (
    "id" UUID NOT NULL,
    "source_key" VARCHAR(160) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "source_type" VARCHAR(24) NOT NULL,
    "endpoint_url" TEXT NOT NULL,
    "is_trusted_for_alerts" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_fetch_status" VARCHAR(10),
    "last_attempt_at" TIMESTAMPTZ(6),
    "last_success_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "market_source_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "market_article" (
    "id" UUID NOT NULL,
    "canonical_url" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "published_at" TIMESTAMPTZ(6),
    "content_hash" VARCHAR(64) NOT NULL,
    "duplicate_of_id" UUID,
    "feed_status" VARCHAR(10) NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "market_article_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "article_source" (
    "article_id" UUID NOT NULL,
    "source_id" UUID NOT NULL,
    "source_url" TEXT NOT NULL,
    "normalized_source_url" TEXT NOT NULL,
    "first_seen_at" TIMESTAMPTZ(6) NOT NULL,
    "last_seen_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "article_source_pkey" PRIMARY KEY ("article_id","source_id")
);

-- CreateTable
CREATE TABLE "article_category" (
    "article_id" UUID NOT NULL,
    "category_code" VARCHAR(30) NOT NULL,

    CONSTRAINT "article_category_pkey" PRIMARY KEY ("article_id","category_code")
);

-- CreateTable
CREATE TABLE "threat_alert" (
    "id" UUID NOT NULL,
    "threat_category" VARCHAR(40) NOT NULL,
    "tactic_summary" TEXT NOT NULL,
    "prevention_guidance" TEXT NOT NULL,
    "verification_status" VARCHAR(20) NOT NULL DEFAULT 'UNVERIFIED',
    "issued_at" TIMESTAMPTZ(6),
    "published_at" TIMESTAMPTZ(6),
    "verified_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "threat_alert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "threat_evidence" (
    "threat_alert_id" UUID NOT NULL,
    "article_id" UUID NOT NULL,
    "source_id" UUID NOT NULL,
    "added_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "threat_evidence_pkey" PRIMARY KEY ("threat_alert_id","article_id","source_id")
);

-- CreateTable
CREATE TABLE "threat_indicator" (
    "id" UUID NOT NULL,
    "threat_alert_id" UUID NOT NULL,
    "indicator_text" TEXT NOT NULL,
    "indicator_type" VARCHAR(50) NOT NULL,

    CONSTRAINT "threat_indicator_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "full_name" VARCHAR(150),
    "auth_provider" VARCHAR(30) NOT NULL DEFAULT 'EMAIL',
    "provider_user_id" VARCHAR(255),
    "password_hash" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "financial_profiles" (
    "id" UUID NOT NULL,
    "user_id" UUID,
    "guest_session_id" UUID,
    "monthly_income_vnd" DECIMAL(18,2),
    "monthly_expense_vnd" DECIMAL(18,2),
    "existing_debt_payment_vnd" DECIMAL(18,2),
    "liquid_savings_vnd" DECIMAL(18,2),
    "risk_appetite" VARCHAR(20) NOT NULL DEFAULT 'BALANCED',
    "primary_goal" VARCHAR(30) NOT NULL DEFAULT 'BORROW_SAFE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "financial_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "article_impact_analyses" (
    "id" UUID NOT NULL,
    "article_id" UUID NOT NULL,
    "profile_id" UUID,
    "analysis_mode" VARCHAR(20) NOT NULL,
    "extracted_facts_json" JSONB NOT NULL,
    "ai_assessment_json" JSONB NOT NULL,
    "suggested_rate_delta" DECIMAL(6,3),
    "llm_provider" VARCHAR(40) NOT NULL,
    "llm_model" VARCHAR(80) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "article_impact_analyses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "financial_institutions" (
    "id" UUID NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "institution_type" VARCHAR(30) NOT NULL,
    "license_issuer" VARCHAR(30) NOT NULL,
    "license_number" VARCHAR(100) NOT NULL,
    "official_website" TEXT NOT NULL,
    "vietqr_bin" VARCHAR(12),
    "trust_status" VARCHAR(20) NOT NULL DEFAULT 'LICENSED',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "financial_institutions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "financial_products" (
    "id" UUID NOT NULL,
    "institution_id" UUID NOT NULL,
    "product_category" VARCHAR(30) NOT NULL,
    "product_name" VARCHAR(200) NOT NULL,
    "calc_method" VARCHAR(30) NOT NULL,
    "rate_type" VARCHAR(20) NOT NULL,
    "nominal_rate_min" DECIMAL(7,4) NOT NULL,
    "nominal_rate_max" DECIMAL(7,4) NOT NULL,
    "promo_months" INTEGER,
    "floating_margin" DECIMAL(7,4),
    "upfront_fee_rate" DECIMAL(7,4) DEFAULT 0,
    "monthly_fee_vnd" DECIMAL(18,2) DEFAULT 0,
    "early_settlement_fee_rate" DECIMAL(7,4) DEFAULT 0,
    "min_amount_vnd" DECIMAL(18,2) NOT NULL,
    "max_amount_vnd" DECIMAL(18,2) NOT NULL,
    "min_term_months" INTEGER NOT NULL,
    "max_term_months" INTEGER NOT NULL,
    "source_url" TEXT NOT NULL,
    "effective_date" DATE NOT NULL,
    "data_provenance" VARCHAR(20) NOT NULL DEFAULT 'CATALOG_VERIFIED',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "financial_products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "calculation_sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID,
    "guest_session_id" UUID,
    "profile_id" UUID,
    "session_mode" VARCHAR(30) NOT NULL,
    "input_params_json" JSONB NOT NULL,
    "math_results_json" JSONB NOT NULL,
    "dti_ratio_pct" DECIMAL(6,2),
    "dti_risk_band" VARCHAR(20),
    "rate_shock_delta" DECIMAL(6,3),
    "ai_explanation_json" JSONB,
    "llm_provider" VARCHAR(40),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "calculation_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "forensic_audits" (
    "id" UUID NOT NULL,
    "user_id" UUID,
    "guest_session_id" UUID,
    "claimed_entity_name" VARCHAR(200),
    "input_channels" JSONB NOT NULL,
    "raw_text_masked" TEXT,
    "extracted_claims_json" JSONB NOT NULL,
    "principal_nominal_vnd" DECIMAL(18,2),
    "principal_net_vnd" DECIMAL(18,2),
    "quoted_rate_pct" DECIMAL(7,4),
    "effective_apr_pct" DECIMAL(8,4),
    "risk_score" INTEGER NOT NULL,
    "verdict_level" VARCHAR(20) NOT NULL,
    "deterministic_override" BOOLEAN NOT NULL DEFAULT false,
    "ai_explanation_text" TEXT NOT NULL,
    "llm_provider" VARCHAR(40) NOT NULL,
    "source_files_purged_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "forensic_audits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "forensic_qr_payloads" (
    "id" UUID NOT NULL,
    "audit_id" UUID NOT NULL,
    "raw_qr_string" TEXT NOT NULL,
    "acq_bin" VARCHAR(12),
    "bank_name" VARCHAR(120),
    "account_number_masked" VARCHAR(64),
    "service_code" VARCHAR(30),
    "qr_amount_vnd" DECIMAL(18,2),
    "purpose_text" TEXT,
    "crc_valid" BOOLEAN NOT NULL,
    "vision_beneficiary_name" VARCHAR(150),
    "entity_mismatch_flag" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "forensic_qr_payloads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "forensic_findings" (
    "id" UUID NOT NULL,
    "audit_id" UUID NOT NULL,
    "rule_code" VARCHAR(50) NOT NULL,
    "severity" VARCHAR(20) NOT NULL,
    "score_impact" INTEGER NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "description" TEXT NOT NULL,
    "evidence_quote" TEXT NOT NULL,
    "matched_indicator_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "forensic_findings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "market_source_source_key_key" ON "market_source"("source_key");

-- CreateIndex
CREATE UNIQUE INDEX "market_article_canonical_url_key" ON "market_article"("canonical_url");

-- CreateIndex
CREATE INDEX "threat_evidence_article_id_source_id_idx" ON "threat_evidence"("article_id", "source_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "financial_profiles_user_id_key" ON "financial_profiles"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "financial_profiles_guest_session_id_key" ON "financial_profiles"("guest_session_id");

-- CreateIndex
CREATE UNIQUE INDEX "financial_institutions_code_key" ON "financial_institutions"("code");

-- AddForeignKey
ALTER TABLE "market_article" ADD CONSTRAINT "market_article_duplicate_of_id_fkey" FOREIGN KEY ("duplicate_of_id") REFERENCES "market_article"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "article_source" ADD CONSTRAINT "article_source_article_id_fkey" FOREIGN KEY ("article_id") REFERENCES "market_article"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "article_source" ADD CONSTRAINT "article_source_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "market_source"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "article_category" ADD CONSTRAINT "article_category_article_id_fkey" FOREIGN KEY ("article_id") REFERENCES "market_article"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "threat_evidence" ADD CONSTRAINT "threat_evidence_threat_alert_id_fkey" FOREIGN KEY ("threat_alert_id") REFERENCES "threat_alert"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "threat_evidence" ADD CONSTRAINT "threat_evidence_article_id_source_id_fkey" FOREIGN KEY ("article_id", "source_id") REFERENCES "article_source"("article_id", "source_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "threat_indicator" ADD CONSTRAINT "threat_indicator_threat_alert_id_fkey" FOREIGN KEY ("threat_alert_id") REFERENCES "threat_alert"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "financial_profiles" ADD CONSTRAINT "financial_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "article_impact_analyses" ADD CONSTRAINT "article_impact_analyses_article_id_fkey" FOREIGN KEY ("article_id") REFERENCES "market_article"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "article_impact_analyses" ADD CONSTRAINT "article_impact_analyses_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "financial_profiles"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "financial_products" ADD CONSTRAINT "financial_products_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "financial_institutions"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "calculation_sessions" ADD CONSTRAINT "calculation_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "calculation_sessions" ADD CONSTRAINT "calculation_sessions_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "financial_profiles"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "forensic_audits" ADD CONSTRAINT "forensic_audits_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "forensic_qr_payloads" ADD CONSTRAINT "forensic_qr_payloads_audit_id_fkey" FOREIGN KEY ("audit_id") REFERENCES "forensic_audits"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "forensic_findings" ADD CONSTRAINT "forensic_findings_audit_id_fkey" FOREIGN KEY ("audit_id") REFERENCES "forensic_audits"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "forensic_findings" ADD CONSTRAINT "forensic_findings_matched_indicator_id_fkey" FOREIGN KEY ("matched_indicator_id") REFERENCES "threat_indicator"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
