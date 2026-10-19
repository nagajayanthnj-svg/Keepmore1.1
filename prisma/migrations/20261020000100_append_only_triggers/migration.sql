-- LedgerEntry and AuditEvent are append-only: the database refuses UPDATE and DELETE.
-- Prisma does not model triggers, so they live in this migration only.
-- WebhookEvent is not covered: processedAt and result are set after the event is stored.

CREATE TRIGGER "LedgerEntry_no_update" BEFORE UPDATE ON "LedgerEntry"
BEGIN
    SELECT RAISE(ABORT, 'LedgerEntry is append-only');
END;

CREATE TRIGGER "LedgerEntry_no_delete" BEFORE DELETE ON "LedgerEntry"
BEGIN
    SELECT RAISE(ABORT, 'LedgerEntry is append-only');
END;

CREATE TRIGGER "AuditEvent_no_update" BEFORE UPDATE ON "AuditEvent"
BEGIN
    SELECT RAISE(ABORT, 'AuditEvent is append-only');
END;

CREATE TRIGGER "AuditEvent_no_delete" BEFORE DELETE ON "AuditEvent"
BEGIN
    SELECT RAISE(ABORT, 'AuditEvent is append-only');
END;
