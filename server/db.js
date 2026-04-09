import Database from 'better-sqlite3';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DB_PATH || join(__dirname, '..', 'london-runs.db');

const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE INDEX IF NOT EXISTS idx_road_segments_postcode ON road_segments(postcode);
  CREATE INDEX IF NOT EXISTS idx_road_coverage_covered ON road_coverage(covered);
`);

// Startup repair: ensure road_coverage rows exist for every road_segment.
// Fast no-op if all rows are present. Guards against accidental wipes.
db.prepare(`
  INSERT OR IGNORE INTO road_coverage (road_segment_id, covered, covered_length_m)
  SELECT id, 0, 0 FROM road_segments
`).run();

// If road_coverage has no covered rows but activities are marked matched,
// reset matched so the next sync re-derives coverage from the road data.
const coveredCount = db.prepare('SELECT COUNT(*) as n FROM road_coverage WHERE covered=1').get().n;
const matchedCount = db.prepare('SELECT COUNT(*) as n FROM activities WHERE matched=1').get().n;
if (coveredCount === 0 && matchedCount > 0) {
  db.prepare('UPDATE activities SET matched=0').run();
  console.log('[db] Coverage rows missing — reset activities to unmatched for re-sync.');
}

db.exec(`
  CREATE TABLE IF NOT EXISTS tokens (
    id INTEGER PRIMARY KEY DEFAULT 1,
    access_token TEXT NOT NULL,
    refresh_token TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    athlete_id INTEGER,
    athlete_name TEXT
  );

  CREATE TABLE IF NOT EXISTS activities (
    id TEXT PRIMARY KEY,
    name TEXT,
    distance REAL,
    moving_time INTEGER,
    start_date TEXT,
    polyline TEXT,
    start_lat REAL,
    start_lng REAL,
    matched INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS road_segments (
    id TEXT PRIMARY KEY,
    osm_id TEXT,
    name TEXT,
    postcode TEXT,
    geometry TEXT,
    length_m REAL,
    highway_type TEXT
  );

  CREATE TABLE IF NOT EXISTS road_coverage (
    road_segment_id TEXT NOT NULL,
    covered INTEGER DEFAULT 0,
    covered_length_m REAL DEFAULT 0,
    PRIMARY KEY (road_segment_id),
    FOREIGN KEY (road_segment_id) REFERENCES road_segments(id)
  );

  CREATE TABLE IF NOT EXISTS postcode_boundaries (
    postcode TEXT PRIMARY KEY,
    boundary TEXT,
    centroid_lat REAL,
    centroid_lng REAL,
    total_roads INTEGER DEFAULT 0,
    total_length_m REAL DEFAULT 0,
    covered_length_m REAL DEFAULT 0,
    coverage_pct REAL DEFAULT 0,
    roads_fetched INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS sync_state (
    key TEXT PRIMARY KEY,
    value TEXT
  );
`);

export default db;
