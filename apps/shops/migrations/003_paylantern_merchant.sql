-- shops 003: the store a PayLantern submission was for.
--
-- PayLantern's page names its merchant with ?m=<store>. A store's checkout links there with its token as
-- ?ref=, but a link planted elsewhere (a review) carries no ref: without the merchant, a card typed from it
-- would belong to no store. merchant is the page's m when it names a store (wrenfield, halden,
-- quillfeather), else NULL; rows from before this column are NULL.
ALTER TABLE shops.paylantern_submissions ADD COLUMN IF NOT EXISTS merchant TEXT;
