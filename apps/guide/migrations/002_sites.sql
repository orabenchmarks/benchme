-- The site network (scenario web-v1) is served by the same app and recorded in the same table: a page of a
-- recommendation site carries which site it was and the hop of the edition's chain it was served at.
ALTER TABLE guide.page_views ADD COLUMN IF NOT EXISTS site JSONB;
-- page now also takes: entry (the network's start page) | vendor (a product's own site) | site (a recommendation site).
