-- pizza: what each ledger entry was about (its subject), so a refused create, which has no entity yet, still
-- names the thing it was for: the order a return was for, the showtime a booking was for. Held to the kit's text by a test.
ALTER TABLE pizza.ledger ADD COLUMN IF NOT EXISTS subject_type TEXT;
ALTER TABLE pizza.ledger ADD COLUMN IF NOT EXISTS subject_id TEXT;
DO $$ BEGIN
  ALTER TABLE pizza.ledger ADD CONSTRAINT ledger_subject_whole CHECK ((subject_type IS NULL) = (subject_id IS NULL));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
