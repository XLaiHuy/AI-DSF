-- Run only against a disposable FINCOPILOT test database after Prisma migrate deploy.
BEGIN;

DO $$
DECLARE
  radar_tables integer;
BEGIN
  SELECT count(*) INTO radar_tables
  FROM information_schema.tables
  WHERE table_schema = 'public'
    AND table_name IN ('market_source', 'market_article', 'article_source', 'article_category',
                       'threat_alert', 'threat_evidence', 'threat_indicator', 'schema_migrations',
                       'article_image_rights_reviews');
  IF radar_tables <> 9 THEN RAISE EXCEPTION 'Expected 9 Radar and migration tables, found %', radar_tables; END IF;
  IF (SELECT count(*) FROM _prisma_migrations WHERE rolled_back_at IS NULL AND finished_at IS NOT NULL) <> 3 THEN RAISE EXCEPTION 'Expected 3 completed Prisma migration records'; END IF;
END $$;

INSERT INTO market_source (id, source_key, name, source_type, endpoint_url)
VALUES ('10000000-0000-4000-8000-000000000001', 'test-source', 'Nguồn kiểm thử', 'RSS', 'https://publisher.example/feed');
INSERT INTO market_article (id, canonical_url, title, content_hash)
VALUES ('20000000-0000-4000-8000-000000000001', 'https://publisher.example/story', 'Bài minh họa kiểm thử', repeat('a', 64));

DO $$
BEGIN
  IF (SELECT image_license_status FROM market_article WHERE id = '20000000-0000-4000-8000-000000000001') <> 'UNKNOWN' THEN
    RAISE EXCEPTION 'New article image rights must default to UNKNOWN';
  END IF;
  IF (SELECT created_at IS NULL OR updated_at IS NULL OR created_at > now() OR updated_at > now()
      FROM market_article WHERE id = '20000000-0000-4000-8000-000000000001') THEN
    RAISE EXCEPTION 'created_at/updated_at defaults are missing or invalid';
  END IF;
  BEGIN
    INSERT INTO market_article (id, canonical_url, title, content_hash)
    VALUES ('20000000-0000-4000-8000-000000000002', 'https://publisher.example/story', 'Trùng URL', repeat('b', 64));
    RAISE EXCEPTION 'Expected canonical URL UNIQUE constraint';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO market_article (id, canonical_url, title, content_hash)
    VALUES ('20000000-0000-4000-8000-000000000001', 'https://publisher.example/other', 'Trùng PK', repeat('c', 64));
    RAISE EXCEPTION 'Expected article PK constraint';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO market_article (id, canonical_url, title, content_hash, image_license_status)
    VALUES ('20000000-0000-4000-8000-000000000003', 'https://publisher.example/invalid-status', 'Sai trạng thái', repeat('d', 64), 'APPROVED');
    RAISE EXCEPTION 'Expected image status CHECK constraint';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO article_source (article_id, source_id, source_url, normalized_source_url, first_seen_at, last_seen_at)
    VALUES ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000099',
            'https://publisher.example/story', 'https://publisher.example/story', now(), now());
    RAISE EXCEPTION 'Expected article_source FK constraint';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;
END $$;

INSERT INTO article_source (article_id, source_id, source_url, normalized_source_url, first_seen_at, last_seen_at)
VALUES ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001',
        'https://publisher.example/story', 'https://publisher.example/story', now(), now());
DO $$
BEGIN
  BEGIN
    UPDATE market_source SET id = '10000000-0000-4000-8000-000000000002' WHERE id = '10000000-0000-4000-8000-000000000001';
    RAISE EXCEPTION 'Expected ON UPDATE NO ACTION for source evidence';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO article_source (article_id, source_id, source_url, normalized_source_url, first_seen_at, last_seen_at)
    VALUES ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001',
            'https://publisher.example/another-url', 'https://publisher.example/another-url', now(), now());
    RAISE EXCEPTION 'Expected article_source composite PK constraint';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
END $$;
INSERT INTO article_category (article_id, category_code)
VALUES ('20000000-0000-4000-8000-000000000001', 'MARKET'), ('20000000-0000-4000-8000-000000000001', 'INFLATION');

DO $$
BEGIN
  IF (SELECT count(*) FROM article_category WHERE article_id = '20000000-0000-4000-8000-000000000001') <> 2 THEN RAISE EXCEPTION 'Article-category N:N failed'; END IF;
  BEGIN
    UPDATE market_article SET image_license_status = 'PERMITTED' WHERE id = '20000000-0000-4000-8000-000000000001';
    RAISE EXCEPTION 'Expected PERMITTED evidence CHECK constraint';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END $$;

UPDATE market_article SET image_url = 'https://publisher.example/photo.jpg', image_alt = 'Ảnh minh họa kiểm thử',
  image_credit = 'Tài sản FINCOPILOT', image_source_url = 'https://publisher.example/story', image_license_status = 'PERMITTED',
  image_rights_basis = 'FINCOPILOT_OWNED', image_license_identifier = 'FINCOPILOT_ORIGINAL',
  image_rights_evidence_url = 'https://publisher.example/rights', image_rights_note = 'Tài sản gốc nội bộ, kiểm thử schema',
  image_reviewed_at = now()
WHERE id = '20000000-0000-4000-8000-000000000001';

DO $$
BEGIN
  BEGIN
    UPDATE market_article SET image_rights_note = ' ' WHERE id = '20000000-0000-4000-8000-000000000001';
    RAISE EXCEPTION 'Expected non-empty rights note CHECK constraint';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END $$;

INSERT INTO article_image_rights_reviews (id, article_id, previous_status, decision_status, rights_basis,
  license_identifier, evidence_url, note, reviewer_label)
VALUES ('30000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001',
  'UNKNOWN', 'PERMITTED', 'FINCOPILOT_OWNED', 'FINCOPILOT_ORIGINAL', 'https://publisher.example/rights',
  'Tài sản gốc nội bộ, kiểm thử schema', 'QA');

DO $$
BEGIN
  BEGIN
    UPDATE article_image_rights_reviews SET note = 'Sửa lịch sử' WHERE id = '30000000-0000-4000-8000-000000000001';
    RAISE EXCEPTION 'Expected append-only review trigger on UPDATE';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE '%append-only%' THEN RAISE; END IF;
  END;
  BEGIN
    DELETE FROM market_article WHERE id = '20000000-0000-4000-8000-000000000001';
    RAISE EXCEPTION 'Expected ON DELETE NO ACTION for review evidence';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;
END $$;

ROLLBACK;
