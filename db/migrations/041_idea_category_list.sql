-- 041 The agreed ten idea categories

-- Every tenant started with five: Safety, Quality, Productivity, Delivery and
-- Sustenance. Five more were agreed, and the order was settled at the same time.
--
-- INSERT IGNORE against the unique name, so a tenant that already added one of
-- these by hand keeps its own row rather than getting a duplicate.
INSERT IGNORE INTO idea_categories (name, sort_order) VALUES
  ('Safety',          1),
  ('Quality',         2),
  ('Productivity',    3),
  ('Delivery',        4),
  ('Cost Reduction',  5),
  ('Waste Reduction', 6),
  ('Innovation',      7),
  ('Simplification',  8),
  ('Sustenance',      9),
  ('Infrastructure', 10);

-- Put the ten in the agreed order even where they already existed, since the
-- five originals were numbered 1-5 and Sustenance has to move to 9.
UPDATE idea_categories SET sort_order = 1  WHERE name = 'Safety';
UPDATE idea_categories SET sort_order = 2  WHERE name = 'Quality';
UPDATE idea_categories SET sort_order = 3  WHERE name = 'Productivity';
UPDATE idea_categories SET sort_order = 4  WHERE name = 'Delivery';
UPDATE idea_categories SET sort_order = 5  WHERE name = 'Cost Reduction';
UPDATE idea_categories SET sort_order = 6  WHERE name = 'Waste Reduction';
UPDATE idea_categories SET sort_order = 7  WHERE name = 'Innovation';
UPDATE idea_categories SET sort_order = 8  WHERE name = 'Simplification';
UPDATE idea_categories SET sort_order = 9  WHERE name = 'Sustenance';
UPDATE idea_categories SET sort_order = 10 WHERE name = 'Infrastructure';

-- Anything an organisation added itself sorts after the ten rather than being
-- interleaved with them by an old number.
UPDATE idea_categories SET sort_order = sort_order + 100
 WHERE sort_order < 100
   AND name NOT IN ('Safety','Quality','Productivity','Delivery','Cost Reduction',
                    'Waste Reduction','Innovation','Simplification','Sustenance',
                    'Infrastructure');
