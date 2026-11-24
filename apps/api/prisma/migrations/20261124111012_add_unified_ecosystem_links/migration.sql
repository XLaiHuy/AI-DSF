-- AlterTable
ALTER TABLE "calculation_sessions" ADD COLUMN     "source_article_id" UUID,
ADD COLUMN     "source_audit_id" UUID;

-- AlterTable
ALTER TABLE "forensic_audits" ADD COLUMN     "profile_id" UUID,
ADD COLUMN     "source_alert_id" UUID;

-- AlterTable
ALTER TABLE "market_article" ADD COLUMN     "image_url" TEXT;

-- CreateIndex
CREATE INDEX "calculation_sessions_source_article_id_idx" ON "calculation_sessions"("source_article_id");

-- CreateIndex
CREATE INDEX "calculation_sessions_source_audit_id_idx" ON "calculation_sessions"("source_audit_id");

-- CreateIndex
CREATE INDEX "forensic_audits_profile_id_idx" ON "forensic_audits"("profile_id");

-- CreateIndex
CREATE INDEX "forensic_audits_source_alert_id_idx" ON "forensic_audits"("source_alert_id");

-- AddForeignKey
ALTER TABLE "calculation_sessions" ADD CONSTRAINT "calculation_sessions_source_article_id_fkey" FOREIGN KEY ("source_article_id") REFERENCES "market_article"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "calculation_sessions" ADD CONSTRAINT "calculation_sessions_source_audit_id_fkey" FOREIGN KEY ("source_audit_id") REFERENCES "forensic_audits"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "forensic_audits" ADD CONSTRAINT "forensic_audits_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "financial_profiles"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "forensic_audits" ADD CONSTRAINT "forensic_audits_source_alert_id_fkey" FOREIGN KEY ("source_alert_id") REFERENCES "threat_alert"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
