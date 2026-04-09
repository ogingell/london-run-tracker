import { Router } from 'express';
import * as turf from '@turf/turf';
import db from './db.js';

const router = Router();

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
const LONDON_BBOX = '51.28,-0.51,51.70,0.33';

// Same London boundary polygon used by postcodes.js for clipping Voronoi cells
const LONDON_BOUNDARY = turf.polygon([[
  [-0.5104, 51.2868], [-0.4740, 51.2760], [-0.4100, 51.2770],
  [-0.3380, 51.2860], [-0.2730, 51.2920], [-0.2040, 51.3030],
  [-0.1380, 51.3120], [-0.0720, 51.3050], [-0.0130, 51.3100],
  [0.0440, 51.3170], [0.0930, 51.3260], [0.1440, 51.3380],
  [0.1770, 51.3570], [0.2060, 51.3790], [0.2270, 51.4040],
  [0.2390, 51.4330], [0.2440, 51.4600], [0.2370, 51.4880],
  [0.2210, 51.5160], [0.2100, 51.5450], [0.2060, 51.5740],
  [0.1890, 51.6000], [0.1650, 51.6200], [0.1380, 51.6380],
  [0.1050, 51.6520], [0.0680, 51.6620], [0.0270, 51.6700],
  [-0.0160, 51.6740], [-0.0640, 51.6720], [-0.1100, 51.6690],
  [-0.1580, 51.6700], [-0.2060, 51.6740], [-0.2540, 51.6720],
  [-0.2990, 51.6650], [-0.3420, 51.6530], [-0.3800, 51.6370],
  [-0.4120, 51.6170], [-0.4370, 51.5940], [-0.4560, 51.5680],
  [-0.4720, 51.5400], [-0.4850, 51.5100], [-0.5020, 51.4800],
  [-0.5140, 51.4490], [-0.5200, 51.4170], [-0.5190, 51.3850],
  [-0.5160, 51.3530], [-0.5104, 51.2868],
]]);

function buildVoronoiBoundaries(centroids) {
  const points = turf.featureCollection(
    centroids.map(c => turf.point([c.lng, c.lat], { id: c.id }))
  );
  const bbox = turf.bbox(LONDON_BOUNDARY);
  let voronoi;
  try { voronoi = turf.voronoi(points, { bbox }); } catch { return new Map(); }
  if (!voronoi?.features) return new Map();

  const result = new Map();
  for (let i = 0; i < voronoi.features.length; i++) {
    const cell = voronoi.features[i];
    const c = centroids[i];
    if (!cell || !c) continue;
    let clipped = cell;
    try { clipped = turf.intersect(turf.featureCollection([cell, LONDON_BOUNDARY])); } catch {}
    if (clipped) result.set(c.id, clipped);
  }
  return result;
}

const yield_ = () => new Promise(r => setImmediate(r));

// Fetch London neighbourhood/place boundaries from OSM
async function fetchPlaceBoundaries() {
  const query = `
    [out:json][timeout:180];
    (
      relation["place"~"^(suburb|neighbourhood|quarter|village|town)$"]["name"](${LONDON_BBOX});
      node["place"~"^(suburb|neighbourhood|quarter|village|town)$"]["name"](${LONDON_BBOX});
    );
    out geom;
  `;

  const res = await fetch(OVERPASS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `data=${encodeURIComponent(query)}`,
  });
  if (!res.ok) throw new Error(`Overpass error: ${res.status}`);
  return res.json();
}

function osmRelationToPolygon(relation) {
  if (!relation.members) return null;
  const outerWays = relation.members.filter(m => m.type === 'way' && m.role === 'outer' && m.geometry);
  if (!outerWays.length) return null;

  const segments = outerWays.map(w => w.geometry.map(n => [n.lon, n.lat]));
  const ring = [...segments[0]];
  const used = new Set([0]);

  for (let i = 1; i < segments.length; i++) {
    const last = ring[ring.length - 1];
    for (let j = 0; j < segments.length; j++) {
      if (used.has(j)) continue;
      const seg = segments[j];
      const d1 = Math.abs(seg[0][0] - last[0]) + Math.abs(seg[0][1] - last[1]);
      const d2 = Math.abs(seg[seg.length-1][0] - last[0]) + Math.abs(seg[seg.length-1][1] - last[1]);
      if (d1 < 0.0001) { ring.push(...seg.slice(1)); used.add(j); break; }
      if (d2 < 0.0001) { ring.push(...[...seg].reverse().slice(1)); used.add(j); break; }
    }
  }

  if (ring.length < 4) return null;
  if (ring[0][0] !== ring[ring.length-1][0] || ring[0][1] !== ring[ring.length-1][1]) ring.push(ring[0]);
  try { return turf.polygon([ring]); } catch { return null; }
}

// Initialize places tables
db.exec(`
  CREATE TABLE IF NOT EXISTS places (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    place_type TEXT,
    boundary TEXT,
    centroid_lat REAL,
    centroid_lng REAL,
    total_roads INTEGER DEFAULT 0,
    total_length_m REAL DEFAULT 0,
    covered_length_m REAL DEFAULT 0,
    coverage_pct REAL DEFAULT 0,
    roads_fetched INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS place_road_segments (
    id TEXT PRIMARY KEY,
    osm_id TEXT,
    name TEXT,
    place_id TEXT,
    geometry TEXT,
    length_m REAL,
    highway_type TEXT
  );

  CREATE TABLE IF NOT EXISTS place_road_coverage (
    road_segment_id TEXT NOT NULL,
    covered INTEGER DEFAULT 0,
    covered_length_m REAL DEFAULT 0,
    PRIMARY KEY (road_segment_id),
    FOREIGN KEY (road_segment_id) REFERENCES place_road_segments(id)
  );
`);

// ── Derive place coverage from already-loaded postcode road data ──────────────
// No Overpass queries needed — reuses road_segments + road_coverage already in DB.
export async function computePlacesCoverage(send) {
  const places = db.prepare('SELECT id, boundary FROM places').all();
  if (!places.length) return 0;

  // Load all road segments from fetched postcodes, with their coverage
  const roads = db.prepare(`
    SELECT rs.id, rs.geometry, rs.length_m,
           COALESCE(rc.covered, 0) as covered,
           COALESCE(rc.covered_length_m, 0) as covered_length_m
    FROM road_segments rs
    LEFT JOIN road_coverage rc ON rc.road_segment_id = rs.id
    WHERE rs.postcode IN (SELECT postcode FROM postcode_boundaries WHERE roads_fetched = 1)
  `).all();

  if (!roads.length) {
    send?.({ type: 'status', message: 'No road data loaded yet — run Globe scan first.' });
    return 0;
  }

  send?.({ type: 'status', message: `Mapping ${roads.length} roads to ${places.length} neighbourhoods...` });

  // Parse centroid for each road (one-time cost)
  const roadPoints = [];
  for (const road of roads) {
    try {
      const geom = JSON.parse(road.geometry);
      const c = turf.centroid(turf.feature(geom));
      roadPoints.push({
        id: road.id,
        length_m: road.length_m,
        covered: road.covered,
        covered_length_m: road.covered_length_m,
        cx: c.geometry.coordinates[0],
        cy: c.geometry.coordinates[1],
      });
    } catch {}
  }

  // For each place: bbox pre-filter → point-in-polygon → accumulate stats
  const updates = [];
  for (let i = 0; i < places.length; i++) {
    const place = places[i];
    try {
      const placeGeo = JSON.parse(place.boundary);
      const [minLng, minLat, maxLng, maxLat] = turf.bbox(turf.feature(placeGeo));

      let totalRoads = 0, totalLength = 0, coveredLength = 0;

      for (const road of roadPoints) {
        // Fast bbox reject
        if (road.cx < minLng || road.cx > maxLng || road.cy < minLat || road.cy > maxLat) continue;
        // Precise point-in-polygon
        if (!turf.booleanPointInPolygon(turf.point([road.cx, road.cy]), turf.feature(placeGeo))) continue;
        totalRoads++;
        totalLength += road.length_m;
        if (road.covered) coveredLength += Math.min(road.covered_length_m, road.length_m);
      }

      const pct = totalLength > 0 ? (coveredLength / totalLength) * 100 : 0;
      updates.push({ id: place.id, totalRoads, totalLength, coveredLength, pct, fetched: totalRoads > 0 ? 1 : 0 });
    } catch {}

    if ((i + 1) % 30 === 0) await yield_();
  }

  // Write all updates in one transaction
  const updateStmt = db.prepare(`
    UPDATE places SET total_roads=?, total_length_m=?, covered_length_m=?, coverage_pct=?, roads_fetched=?
    WHERE id=?
  `);
  db.transaction(() => {
    for (const u of updates) {
      updateStmt.run(u.totalRoads, u.totalLength, u.coveredLength, u.pct, u.fetched, u.id);
    }
  })();

  const scanned = updates.filter(u => u.fetched).length;
  send?.({ type: 'status', message: `Neighbourhoods updated: ${scanned} of ${places.length} have road data` });
  return scanned;
}

router.get('/status', (req, res) => {
  const count = db.prepare('SELECT COUNT(*) as count FROM places').get();
  res.json({ initialized: count.count > 0, count: count.count });
});

router.post('/reset', (req, res) => {
  db.transaction(() => {
    db.prepare('DELETE FROM place_road_coverage').run();
    db.prepare('DELETE FROM place_road_segments').run();
    db.prepare('DELETE FROM places').run();
  })();
  res.json({ ok: true });
});

router.post('/setup', async (req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json', 'Transfer-Encoding': 'chunked' });
  const send = (data) => res.write(JSON.stringify(data) + '\n');

  try {
    const existing = db.prepare('SELECT COUNT(*) as c FROM places').get();
    if (existing.c > 0) {
      send({ done: true, total: existing.c, cached: true });
      res.end();
      return;
    }

    send({ message: 'Fetching London neighbourhood boundaries from OpenStreetMap...' });
    const osmData = await fetchPlaceBoundaries();
    const elements = osmData.elements || [];
    send({ message: `Processing ${elements.length} place elements...` });

    const BBOX = { minLng: -0.51, maxLng: 0.33, minLat: 51.28, maxLat: 51.70 };

    // Phase 1: collect centroids for all valid places
    const centroids = []; // { id, name, placeType, lat, lng }

    for (const el of elements) {
      const name = el.tags?.name;
      if (!name) continue;
      const placeType = el.tags?.place || 'suburb';
      let lat, lng;

      if (el.type === 'relation') {
        const poly = osmRelationToPolygon(el);
        if (poly) {
          const c = turf.centroid(poly);
          [lng, lat] = c.geometry.coordinates;
        }
      } else if (el.type === 'node' && el.lat && el.lon) {
        lat = el.lat; lng = el.lon;
      }

      if (lat == null) continue;
      if (lng < BBOX.minLng || lng > BBOX.maxLng || lat < BBOX.minLat || lat > BBOX.maxLat) continue;

      centroids.push({ id: `place_${el.type}_${el.id}`, name, placeType, lat, lng });
    }

    send({ message: `${centroids.length} places found — building Voronoi boundaries...` });

    // Phase 2: Voronoi tessellation over all centroids — no overlap guaranteed
    const voronoiMap = buildVoronoiBoundaries(centroids);
    send({ message: `Voronoi done — saving to database...` });

    const insert = db.prepare(`
      INSERT OR IGNORE INTO places (id, name, place_type, boundary, centroid_lat, centroid_lng)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    let added = 0;
    db.transaction(() => {
      for (const c of centroids) {
        const boundary = voronoiMap.get(c.id);
        if (!boundary) continue;
        insert.run(c.id, c.name, c.placeType, JSON.stringify(boundary.geometry), c.lat, c.lng);
        added++;
      }
    })();

    send({ message: `${added} neighbourhoods saved — computing coverage from loaded road data...` });
    await computePlacesCoverage((msg) => send(msg));

    send({ done: true, total: added });
    res.end();
  } catch (err) {
    console.error('Places setup error:', err);
    res.end(JSON.stringify({ error: err.message }) + '\n');
  }
});

// Manual trigger endpoint — recomputes place coverage from current road data
router.post('/compute-coverage', async (req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' });
  const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  try {
    const scanned = await computePlacesCoverage(send);
    send({ type: 'done', scanned });
    res.end();
  } catch (err) {
    send({ type: 'error', message: err.message });
    res.end();
  }
});

router.get('/boundaries', (req, res) => {
  const places = db.prepare(`
    SELECT id, name, place_type, boundary, centroid_lat, centroid_lng,
           total_roads, total_length_m, covered_length_m, coverage_pct, roads_fetched
    FROM places ORDER BY coverage_pct DESC
  `).all();

  res.json({
    type: 'FeatureCollection',
    features: places.map(p => ({
      type: 'Feature',
      properties: {
        id: p.id,
        name: p.name,
        placeType: p.place_type,
        totalRoads: p.total_roads,
        totalLength: p.total_length_m,
        coveredLength: p.covered_length_m,
        coveragePct: p.coverage_pct,
        roadsFetched: p.roads_fetched === 1,
      },
      geometry: JSON.parse(p.boundary),
    })),
  });
});

router.get('/stats', (req, res) => {
  const places = db.prepare(`
    SELECT id, name, place_type, total_roads, total_length_m, covered_length_m, coverage_pct, roads_fetched
    FROM places ORDER BY roads_fetched DESC, coverage_pct DESC, name ASC
  `).all();
  res.json(places);
});

export default router;
