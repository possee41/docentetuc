-- Optional editorial content and licensed media. Existing news remains unchanged.
ALTER TABLE news_items ADD COLUMN editorial_body TEXT;
ALTER TABLE news_items ADD COLUMN hero_image_url TEXT CHECK(hero_image_url IS NULL OR length(hero_image_url) <= 2048);
ALTER TABLE news_items ADD COLUMN hero_image_alt TEXT CHECK(hero_image_alt IS NULL OR length(hero_image_alt) <= 240);
ALTER TABLE news_items ADD COLUMN hero_image_credit TEXT CHECK(hero_image_credit IS NULL OR length(hero_image_credit) <= 160);
ALTER TABLE news_items ADD COLUMN hero_image_source_url TEXT CHECK(hero_image_source_url IS NULL OR length(hero_image_source_url) <= 2048);
ALTER TABLE news_items ADD COLUMN hero_image_rights_note TEXT CHECK(hero_image_rights_note IS NULL OR length(hero_image_rights_note) <= 500);
ALTER TABLE news_items ADD COLUMN hero_image_rights_url TEXT CHECK(hero_image_rights_url IS NULL OR length(hero_image_rights_url) <= 2048);
