-- Admin-controlled discount on landing-page pricing cards. `discount_badge` is
-- the banner text (e.g. "20% OFF"); `setup_original_label` is the pre-discount
-- one-time-setup price shown struck-through beside the (discounted) setup_label.
ALTER TABLE landing_packages
  ADD COLUMN IF NOT EXISTS discount_badge        text,
  ADD COLUMN IF NOT EXISTS setup_original_label  text;

-- Pre-apply a 20% one-time-setup discount on the standard Growth / Premium
-- cards so the banner shows immediately. Guarded: only touches rows still at the
-- original price with no discount set, so it never clobbers an admin edit. The
-- admin can change or clear it any time from Super Admin → Landing packages.
UPDATE landing_packages
   SET setup_original_label = '₹45,000', setup_label = '₹36,000', discount_badge = '20% OFF'
 WHERE lower(name) = 'growth' AND discount_badge IS NULL AND setup_label = '₹45,000';

UPDATE landing_packages
   SET setup_original_label = '₹75,000', setup_label = '₹60,000', discount_badge = '20% OFF'
 WHERE lower(name) = 'premium' AND discount_badge IS NULL AND setup_label = '₹75,000';
