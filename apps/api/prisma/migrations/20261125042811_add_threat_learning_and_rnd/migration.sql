-- AlterTable
ALTER TABLE "threat_alert" ADD COLUMN     "distinct_session_hashes" JSONB,
ADD COLUMN     "hit_count" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "origin_source" VARCHAR(30) NOT NULL DEFAULT 'RADAR_AUTO',
ADD COLUMN     "source_excerpt" TEXT;

-- CreateTable
CREATE TABLE "threat_feedback_examples" (
    "id" UUID NOT NULL,
    "threat_alert_id" UUID,
    "audit_id" UUID,
    "feedback_type" VARCHAR(30) NOT NULL,
    "highlighted_span" TEXT,
    "sample_text_masked" TEXT NOT NULL,
    "expected_verdict" VARCHAR(20) NOT NULL,
    "admin_note" TEXT NOT NULL,
    "rnd_category" VARCHAR(40),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "threat_feedback_examples_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "threat_feedback_examples_feedback_type_is_active_idx" ON "threat_feedback_examples"("feedback_type", "is_active");

-- CreateIndex
CREATE INDEX "threat_feedback_examples_threat_alert_id_idx" ON "threat_feedback_examples"("threat_alert_id");

-- AddForeignKey
ALTER TABLE "threat_feedback_examples" ADD CONSTRAINT "threat_feedback_examples_threat_alert_id_fkey" FOREIGN KEY ("threat_alert_id") REFERENCES "threat_alert"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "threat_feedback_examples" ADD CONSTRAINT "threat_feedback_examples_audit_id_fkey" FOREIGN KEY ("audit_id") REFERENCES "forensic_audits"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
