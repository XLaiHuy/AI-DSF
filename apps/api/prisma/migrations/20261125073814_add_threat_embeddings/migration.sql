-- AlterTable
ALTER TABLE "threat_alert" ADD COLUMN     "embedding_json" JSONB;

-- AlterTable
ALTER TABLE "threat_feedback_examples" ADD COLUMN     "embedding_json" JSONB;
