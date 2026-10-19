-- Initial schema for the twelve tables in docs/TDD.md "Data model".
-- Written to match prisma/schema.prisma. Check for drift with:
--   npx prisma migrate diff --from-migrations prisma/migrations --to-schema prisma/schema.prisma --exit-code
-- (ignores the triggers in the next migration, which Prisma does not model)

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "paypalOrderId" TEXT NOT NULL,
    "captureId" TEXT,
    "itemsJson" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "grossMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "buyerHash" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "LedgerEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orderId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "inrMinor" INTEGER,
    "sourceType" TEXT NOT NULL,
    "sourceRef" TEXT,
    "rate" DECIMAL,
    "rateDate" DATETIME,
    "calcVersion" TEXT NOT NULL,
    "correctsEntryId" TEXT,
    "occurredAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LedgerEntry_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "FxRate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "date" DATETIME NOT NULL,
    "pair" TEXT NOT NULL,
    "rate" DECIMAL NOT NULL,
    "source" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "Shipment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orderId" TEXT NOT NULL,
    "carrier" TEXT NOT NULL,
    "trackingNo" TEXT NOT NULL,
    "pushStatus" TEXT NOT NULL,
    "pushedToPaypalAt" DATETIME,
    "pushError" TEXT,
    "eventsJson" TEXT NOT NULL,
    CONSTRAINT "Shipment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DisputeCase" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "paypalDisputeId" TEXT NOT NULL,
    "orderId" TEXT,
    "reason" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "sellerDeadline" DATETIME,
    "allowedActionsJson" TEXT NOT NULL,
    "requestedEvidence" TEXT NOT NULL,
    "outcomeCode" TEXT,
    "buyerHash" TEXT,
    "lastSyncedAt" DATETIME NOT NULL,
    "rawHash" TEXT NOT NULL,
    CONSTRAINT "DisputeCase_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "EvidenceRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "caseId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "occurredAt" DATETIME NOT NULL,
    "fieldsJson" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "trustState" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "AgentRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "caseId" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "provider" TEXT,
    "model" TEXT,
    "inputHash" TEXT NOT NULL,
    "outputJson" TEXT NOT NULL,
    "validation" TEXT NOT NULL,
    "latencyMs" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "CaseAction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "caseId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "payloadJson" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "approvedBy" TEXT NOT NULL,
    "approvedAt" DATETIME NOT NULL,
    "stateHashAtApproval" TEXT NOT NULL,
    "submittedAt" DATETIME,
    "httpStatus" INTEGER,
    "responseJson" TEXT,
    "idempotencyKey" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "WebhookEvent" (
    "eventId" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL,
    "verified" BOOLEAN NOT NULL,
    "receivedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" DATETIME,
    "result" TEXT
);

-- CreateTable
CREATE TABLE "SellerPolicy" (
    "id" TEXT NOT NULL DEFAULT 'default' PRIMARY KEY,
    "refundThresholdMinor" INTEGER NOT NULL,
    "highValueBandMinor" INTEGER NOT NULL,
    "minCarrierSample" INTEGER NOT NULL DEFAULT 20,
    "returnlessCapPerYear" INTEGER NOT NULL DEFAULT 1,
    "returnPolicyText" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD'
);

-- CreateTable
CREATE TABLE "ReturnlessGrant" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "buyerHash" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "grantedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "entity" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "detailJson" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "Order_paypalOrderId_key" ON "Order"("paypalOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "Order_captureId_key" ON "Order"("captureId");

-- CreateIndex
CREATE UNIQUE INDEX "FxRate_date_pair_source_key" ON "FxRate"("date", "pair", "source");

-- CreateIndex
CREATE UNIQUE INDEX "Shipment_orderId_key" ON "Shipment"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "DisputeCase_paypalDisputeId_key" ON "DisputeCase"("paypalDisputeId");

-- CreateIndex
CREATE UNIQUE INDEX "CaseAction_idempotencyKey_key" ON "CaseAction"("idempotencyKey");
