-- AlterTable
ALTER TABLE "threat_alert" ADD COLUMN     "embedding_model" VARCHAR(64);

-- AlterTable
ALTER TABLE "threat_feedback_examples" ADD COLUMN     "embedding_model" VARCHAR(64);
