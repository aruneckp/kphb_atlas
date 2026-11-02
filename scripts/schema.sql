PRAGMA journal_mode = OFF;
PRAGMA synchronous = OFF;
PRAGMA page_size = 8192;

CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);

CREATE TABLE voters (
  id INTEGER PRIMARY KEY,
  record_key TEXT, part_no INTEGER, serial_no INTEGER, section_no INTEGER, page_no INTEGER,
  epic TEXT, name TEXT, name_en TEXT, rel_type TEXT, rel_name TEXT, rel_name_en TEXT,
  house TEXT, house_key TEXT, age INTEGER, gender TEXT,
  status TEXT, deletion_code TEXT, modified INTEGER, needs_review INTEGER, review_reason TEXT,
  ocr_conf REAL, epic_dup TEXT, name_dup TEXT,
  family_id INTEGER, gen INTEGER, link_to TEXT, link_how TEXT, household_id INTEGER,
  name_key TEXT, rel_key TEXT, source_file TEXT
);

-- relatives named by a voter but not themselves on the roll
CREATE TABLE ghosts (id TEXT PRIMARY KEY, family_id INTEGER, part_no INTEGER, name TEXT, name_en TEXT, gender TEXT, house_key TEXT);

CREATE TABLE families (
  id INTEGER PRIMARY KEY, part_no INTEGER, section_no INTEGER, size INTEGER, ghosts INTEGER, gens INTEGER,
  houses INTEGER, male INTEGER, female INTEGER, head_id INTEGER, head_name TEXT, head_name_en TEXT,
  house_key TEXT, avg_age REAL, min_age INTEGER, max_age INTEGER
);

CREATE TABLE households (
  id INTEGER PRIMARY KEY, part_no INTEGER, section_no INTEGER, house TEXT, house_key TEXT,
  size INTEGER, families INTEGER, male INTEGER, female INTEGER
);

CREATE TABLE stations (
  part_no INTEGER PRIMARY KEY, name TEXT, address TEXT, locality TEXT,
  police TEXT, police_en TEXT, pin TEXT, post_office TEXT, post_office_en TEXT, mandal TEXT, mandal_en TEXT,
  voters INTEGER, male INTEGER, female INTEGER, third INTEGER, avg_age REAL,
  a18_19 INTEGER, a20_29 INTEGER, a30_39 INTEGER, a40_49 INTEGER, a50_59 INTEGER, a60_69 INTEGER, a70_79 INTEGER, a80p INTEGER,
  families INTEGER, households INTEGER, sections INTEGER, review INTEGER,
  cover_total INTEGER, cover_men INTEGER, cover_women INTEGER, sections_cover TEXT,
  lat REAL, lng REAL, geo_source TEXT, source_file TEXT
);

CREATE TABLE sections (
  part_no INTEGER, section_no INTEGER, name TEXT, place TEXT, locality TEXT,
  voters INTEGER, male INTEGER, female INTEGER, avg_age REAL, households INTEGER, families INTEGER,
  PRIMARY KEY (part_no, section_no)
);

-- pins saved from the map page (kept when the database is rebuilt via data/station_geo.csv)
CREATE TABLE IF NOT EXISTS station_pins (part_no INTEGER PRIMARY KEY, lat REAL, lng REAL, saved_at TEXT);

