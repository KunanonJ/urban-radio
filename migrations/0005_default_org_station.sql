-- 0005_default_org_station.sql — seed one default org + station + admin member for the demo user
-- Idempotent: re-running this migration after a successful apply produces zero changes.
-- Rollback: DELETE FROM station_members WHERE station_id='urban-radio';
--           DELETE FROM categories WHERE station_id='urban-radio';
--           DELETE FROM stations WHERE id='urban-radio';
--           DELETE FROM organizations WHERE id='default';

INSERT OR IGNORE INTO organizations (id, name, plan)
VALUES ('default', 'Default organisation', 'free');

INSERT OR IGNORE INTO stations (id, org_id, slug, name, timezone, language)
VALUES ('urban-radio', 'default', 'urban-radio', 'Urban Radio', 'Asia/Bangkok', 'en');

-- Link the demo user as admin. The user id comes from migrations/0003_auth_users.sql.
-- If auth_users is empty this is a no-op (INSERT … SELECT returns 0 rows).
INSERT OR IGNORE INTO station_members (station_id, user_id, role)
SELECT 'urban-radio', id, 'admin'
FROM auth_users
WHERE username = 'demo';

-- Seed categories so the catalog UI has filter chips out of the box.
INSERT OR IGNORE INTO categories (id, station_id, name, color, repeat_protection_minutes)
VALUES
  ('cat-music',   'urban-radio', 'Music',      '#3b82f6', 90),
  ('cat-jingle',  'urban-radio', 'Jingle',     '#f97316',  0),
  ('cat-sweeper', 'urban-radio', 'Sweeper',    '#a855f7',  0),
  ('cat-id',      'urban-radio', 'Station ID', '#10b981',  0),
  ('cat-spot',    'urban-radio', 'Spot',       '#ef4444', 30);
