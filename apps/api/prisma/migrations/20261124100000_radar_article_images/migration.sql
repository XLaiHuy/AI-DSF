CREATE INDEX "market_article_feed_published_idx"
  ON "market_article" ("feed_status", "published_at" DESC, "id" DESC);
CREATE INDEX "market_article_feed_hash_idx"
  ON "market_article" ("feed_status", "content_hash");
CREATE INDEX "article_source_normalized_url_idx"
  ON "article_source" ("source_id", "normalized_source_url");
CREATE INDEX "article_category_code_article_idx"
  ON "article_category" ("category_code", "article_id");
ALTER TABLE "market_article"
  ADD COLUMN "image_url" TEXT,
  ADD COLUMN "image_alt" TEXT,
  ADD COLUMN "image_credit" TEXT,
  ADD COLUMN "image_source_url" TEXT,
  ADD COLUMN "image_license_status" VARCHAR(30) NOT NULL DEFAULT 'UNKNOWN',
  ADD CONSTRAINT "market_article_image_license_status_check"
    CHECK ("image_license_status" IN ('UNKNOWN', 'REVIEW_REQUIRED', 'PERMITTED', 'PROHIBITED')),
  ADD CONSTRAINT "market_article_permitted_image_has_source_check"
    CHECK ("image_license_status" <> 'PERMITTED' OR ("image_url" IS NOT NULL AND "image_source_url" IS NOT NULL));
