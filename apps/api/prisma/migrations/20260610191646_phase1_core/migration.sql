-- CreateEnum
CREATE TYPE "ProfileClaimStatus" AS ENUM ('UNCLAIMED', 'CLAIMED');

-- CreateEnum
CREATE TYPE "ShareStatus" AS ENUM ('ACTIVE', 'REVOKED', 'EXPIRED');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "passwordHash" TEXT;

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "family" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "candidate_profiles" (
    "id" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "claimStatus" "ProfileClaimStatus" NOT NULL DEFAULT 'UNCLAIMED',
    "candidateEmail" TEXT,
    "ownerUserId" TEXT,
    "submittedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "candidate_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "form_submissions" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "answers" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "form_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "score_runs" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "submissionId" TEXT,
    "total" INTEGER NOT NULL,
    "maxTotal" INTEGER NOT NULL,
    "tier" TEXT NOT NULL,
    "byBlock" JSONB NOT NULL,
    "breakdown" JSONB NOT NULL,
    "configVersion" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "score_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "share_grants" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "granteeEmail" TEXT NOT NULL,
    "granteeUserId" TEXT,
    "status" "ShareStatus" NOT NULL DEFAULT 'ACTIVE',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "share_grants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "report_artifacts" (
    "id" TEXT NOT NULL,
    "scoreRunId" TEXT NOT NULL,
    "audience" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "report_artifacts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_tokenHash_key" ON "refresh_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "refresh_tokens_userId_idx" ON "refresh_tokens"("userId");

-- CreateIndex
CREATE INDEX "candidate_profiles_ownerUserId_idx" ON "candidate_profiles"("ownerUserId");

-- CreateIndex
CREATE INDEX "candidate_profiles_candidateEmail_idx" ON "candidate_profiles"("candidateEmail");

-- CreateIndex
CREATE INDEX "form_submissions_profileId_idx" ON "form_submissions"("profileId");

-- CreateIndex
CREATE INDEX "score_runs_profileId_createdAt_idx" ON "score_runs"("profileId", "createdAt");

-- CreateIndex
CREATE INDEX "share_grants_profileId_idx" ON "share_grants"("profileId");

-- CreateIndex
CREATE INDEX "share_grants_granteeEmail_idx" ON "share_grants"("granteeEmail");

-- CreateIndex
CREATE INDEX "report_artifacts_scoreRunId_idx" ON "report_artifacts"("scoreRunId");

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "candidate_profiles" ADD CONSTRAINT "candidate_profiles_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "candidate_profiles" ADD CONSTRAINT "candidate_profiles_submittedByUserId_fkey" FOREIGN KEY ("submittedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "form_submissions" ADD CONSTRAINT "form_submissions_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "candidate_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "score_runs" ADD CONSTRAINT "score_runs_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "candidate_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "score_runs" ADD CONSTRAINT "score_runs_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "form_submissions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "share_grants" ADD CONSTRAINT "share_grants_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "candidate_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "share_grants" ADD CONSTRAINT "share_grants_granteeUserId_fkey" FOREIGN KEY ("granteeUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_artifacts" ADD CONSTRAINT "report_artifacts_scoreRunId_fkey" FOREIGN KEY ("scoreRunId") REFERENCES "score_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
