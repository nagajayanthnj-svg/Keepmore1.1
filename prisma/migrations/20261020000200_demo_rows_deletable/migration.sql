-- The demo reset must be able to remove seeded rows. The delete trigger now lets DEMO_SEEDED rows go
-- and still refuses every other source. UPDATE stays refused for all rows.

DROP TRIGGER "LedgerEntry_no_delete";

CREATE TRIGGER "LedgerEntry_no_delete" BEFORE DELETE ON "LedgerEntry"
WHEN OLD."sourceType" <> 'DEMO_SEEDED'
BEGIN
    SELECT RAISE(ABORT, 'LedgerEntry is append-only');
END;
