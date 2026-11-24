ALTER TABLE "market_article"
  ADD COLUMN "image_rights_basis" VARCHAR(40),
  ADD COLUMN "image_license_identifier" VARCHAR(120),
  ADD COLUMN "image_license_url" TEXT,
  ADD COLUMN "image_rights_evidence_url" TEXT,
  ADD COLUMN "image_rights_note" TEXT,
  ADD COLUMN "image_reviewed_at" TIMESTAMPTZ(6),
  ADD CONSTRAINT "market_article_image_rights_basis_check"
    CHECK ("image_rights_basis" IS NULL OR "image_rights_basis" IN ('PUBLISHER_PERMISSION', 'OPEN_LICENSE', 'PUBLIC_DOMAIN', 'FINCOPILOT_OWNED')),
  ADD CONSTRAINT "market_article_image_license_url_https_check"
    CHECK ("image_license_url" IS NULL OR "image_license_url" LIKE 'https://%'),
  ADD CONSTRAINT "market_article_image_rights_evidence_https_check"
    CHECK ("image_rights_evidence_url" IS NULL OR "image_rights_evidence_url" LIKE 'https://%'),
  ADD CONSTRAINT "market_article_permitted_image_review_check"
    CHECK (
      "image_license_status" <> 'PERMITTED'
      OR (
        "image_url" IS NOT NULL
        AND "image_source_url" IS NOT NULL
        AND length(btrim("image_credit")) > 0
        AND "image_rights_basis" IS NOT NULL
        AND length(btrim("image_license_identifier")) > 0
        AND "image_rights_evidence_url" IS NOT NULL
        AND length(btrim("image_rights_note")) > 0
        AND "image_reviewed_at" IS NOT NULL
      )
    ),
  ADD CONSTRAINT "market_article_open_license_url_check"
    CHECK ("image_rights_basis" <> 'OPEN_LICENSE' OR "image_license_url" IS NOT NULL),
  ADD CONSTRAINT "market_article_permitted_image_https_check"
    CHECK (
      "image_license_status" <> 'PERMITTED'
      OR ("image_url" LIKE 'https://%' AND "image_source_url" LIKE 'https://%' AND length(btrim("image_credit")) > 0)
    );

CREATE TABLE "article_image_rights_reviews" (
  "id" UUID NOT NULL,
  "article_id" UUID NOT NULL,
  "previous_status" VARCHAR(30) NOT NULL,
  "decision_status" VARCHAR(30) NOT NULL,
  "rights_basis" VARCHAR(40),
  "license_identifier" VARCHAR(120),
  "license_url" TEXT,
  "evidence_url" TEXT,
  "note" TEXT NOT NULL,
  "reviewer_label" VARCHAR(120) NOT NULL,
  "reviewed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "article_image_rights_reviews_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "article_image_rights_reviews_article_id_fkey"
    FOREIGN KEY ("article_id") REFERENCES "market_article"("id") ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT "article_image_rights_review_status_check"
    CHECK ("decision_status" IN ('UNKNOWN', 'REVIEW_REQUIRED', 'PERMITTED', 'PROHIBITED')),
  CONSTRAINT "article_image_rights_review_previous_status_check"
    CHECK ("previous_status" IN ('UNKNOWN', 'REVIEW_REQUIRED', 'PERMITTED', 'PROHIBITED')),
  CONSTRAINT "article_image_rights_review_basis_check"
    CHECK ("rights_basis" IS NULL OR "rights_basis" IN ('PUBLISHER_PERMISSION', 'OPEN_LICENSE', 'PUBLIC_DOMAIN', 'FINCOPILOT_OWNED')),
  CONSTRAINT "article_image_rights_review_note_check"
    CHECK (length(btrim("note")) > 0),
  CONSTRAINT "article_image_rights_review_reviewer_check"
    CHECK (length(btrim("reviewer_label")) > 0),
  CONSTRAINT "article_image_rights_review_evidence_https_check"
    CHECK ("evidence_url" IS NULL OR "evidence_url" LIKE 'https://%'),
  CONSTRAINT "article_image_rights_review_license_https_check"
    CHECK ("license_url" IS NULL OR "license_url" LIKE 'https://%'),
  CONSTRAINT "article_image_rights_review_permitted_evidence_check"
    CHECK (
      "decision_status" <> 'PERMITTED'
      OR ("rights_basis" IS NOT NULL AND length(btrim("license_identifier")) > 0 AND "evidence_url" IS NOT NULL)
    ),
  CONSTRAINT "article_image_rights_review_open_license_check"
    CHECK ("rights_basis" <> 'OPEN_LICENSE' OR ("license_url" IS NOT NULL AND length(btrim("license_url")) > 0))
);

CREATE INDEX "article_image_rights_review_history_idx"
  ON "article_image_rights_reviews" ("article_id", "reviewed_at" DESC);

CREATE FUNCTION "reject_image_rights_review_mutation"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'article image rights review history is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "article_image_rights_reviews_append_only"
  BEFORE UPDATE OR DELETE ON "article_image_rights_reviews"
  FOR EACH ROW EXECUTE FUNCTION "reject_image_rights_review_mutation"();
