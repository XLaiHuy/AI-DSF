ALTER TABLE "financial_products"
  ADD COLUMN "redemption_fee_tiers" JSONB,
  ADD COLUMN "investment_tax_pct" DECIMAL(7,4),
  ADD COLUMN "investment_tax_free_after_months" INTEGER,
  ADD COLUMN "rate_note" TEXT,
  ADD COLUMN "catalog_sync_fingerprint" CHAR(64);
