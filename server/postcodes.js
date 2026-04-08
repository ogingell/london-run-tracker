import { Router } from 'express';
import * as turf from '@turf/turf';
import db from './db.js';

const router = Router();

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';

// Greater London bounding box
const LONDON_BBOX = { south: 51.28, west: -0.51, north: 51.70, east: 0.33 };

// Greater London simplified boundary for clipping
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

// Fetch postcode district boundaries from OSM
async function fetchOSMPostcodeBoundaries() {
  const { south, west, north, east } = LONDON_BBOX;
  const query = `
    [out:json][timeout:300];
    (
      relation["boundary"="postal_code"]["admin_level"](${south},${west},${north},${east});
      relation["boundary"="postal_code"](${south},${west},${north},${east});
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

// Convert OSM relation to GeoJSON polygon
function osmRelationToPolygon(relation) {
  if (!relation.members) return null;

  const outerWays = relation.members.filter(m => m.type === 'way' && m.role === 'outer');
  if (!outerWays.length) return null;

  // Collect all coordinate segments
  const segments = outerWays
    .filter(w => w.geometry)
    .map(w => w.geometry.map(n => [n.lon, n.lat]));

  if (!segments.length) return null;

  // Chain segments into a ring
  const ring = [...segments[0]];
  const used = new Set([0]);

  for (let i = 1; i < segments.length; i++) {
    let added = false;
    const last = ring[ring.length - 1];

    for (let j = 0; j < segments.length; j++) {
      if (used.has(j)) continue;
      const seg = segments[j];
      const first = seg[0];
      const lastSeg = seg[seg.length - 1];

      const dist1 = Math.abs(first[0] - last[0]) + Math.abs(first[1] - last[1]);
      const dist2 = Math.abs(lastSeg[0] - last[0]) + Math.abs(lastSeg[1] - last[1]);

      if (dist1 < 0.0001) {
        ring.push(...seg.slice(1));
        used.add(j);
        added = true;
        break;
      } else if (dist2 < 0.0001) {
        ring.push(...[...seg].reverse().slice(1));
        used.add(j);
        added = true;
        break;
      }
    }
    if (!added) break;
  }

  // Close the ring
  if (ring.length < 4) return null;
  if (ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1]) {
    ring.push(ring[0]);
  }

  try {
    const poly = turf.polygon([ring]);
    // Make sure it's valid
    if (!turf.area(poly)) return null;
    return poly;
  } catch {
    return null;
  }
}

// Get postcode tag from OSM relation
function getPostcodeTag(relation) {
  const tags = relation.tags || {};
  return (tags['postal_code'] || tags['addr:postcode'] || tags['name'] || '').trim().toUpperCase();
}

// Extract outcode (e.g. "SE21" from "SE21 8AA")
function toOutcode(str) {
  const match = str.match(/^([A-Z]{1,2}\d{1,2}[A-Z]?)/);
  return match ? match[1] : str;
}

// Build Voronoi boundaries for any postcodes not found in OSM
function buildVoronoiBoundaries(centroids, londonBoundary) {
  if (centroids.length === 0) return new Map();

  const points = turf.featureCollection(
    centroids.map(c => turf.point([c.lng, c.lat], { postcode: c.postcode }))
  );

  const bbox = turf.bbox(londonBoundary);

  let voronoi;
  try {
    voronoi = turf.voronoi(points, { bbox });
  } catch (err) {
    console.warn('Voronoi failed:', err.message);
    return new Map();
  }

  if (!voronoi || !voronoi.features) return new Map();

  const result = new Map();
  for (let i = 0; i < voronoi.features.length; i++) {
    const cell = voronoi.features[i];
    const centroid = centroids[i];
    if (!cell || !centroid) continue;

    // Clip to London boundary
    let clipped = cell;
    try {
      clipped = turf.intersect(
        turf.featureCollection([cell, londonBoundary])
      );
    } catch {}

    if (clipped) {
      result.set(centroid.postcode, clipped);
    }
  }
  return result;
}

// Initialize postcode boundaries
router.post('/setup', async (req, res) => {
  try {
    const existing = db.prepare('SELECT COUNT(*) as count FROM postcode_boundaries').get();
    if (existing.count > 0) {
      return res.json({ message: 'Boundaries already set up', count: existing.count });
    }

    res.writeHead(200, { 'Content-Type': 'application/json', 'Transfer-Encoding': 'chunked' });
    const send = (data) => res.write(JSON.stringify(data) + '\n');

    // Step 1: fetch real OSM postcode boundaries
    send({ progress: 0, message: 'Fetching postcode boundaries from OpenStreetMap...' });

    let osmBoundaries = new Map();
    try {
      const osmData = await fetchOSMPostcodeBoundaries();
      const relations = osmData.elements?.filter(e => e.type === 'relation') || [];
      send({ progress: 10, message: `Processing ${relations.length} OSM postcode regions...` });

      for (const rel of relations) {
        const rawCode = getPostcodeTag(rel);
        if (!rawCode) continue;

        const outcode = toOutcode(rawCode);
        if (!outcode || outcode.length < 2) continue;

        // Only keep London outcodes we haven't seen yet (first wins = largest)
        if (osmBoundaries.has(outcode)) continue;

        const poly = osmRelationToPolygon(rel);
        if (!poly) continue;

        // Check it's in London
        const centroid = turf.centroid(poly);
        try {
          if (!turf.booleanPointInPolygon(centroid, LONDON_BOUNDARY)) continue;
        } catch { continue; }

        osmBoundaries.set(outcode, poly);
      }
      send({ progress: 30, message: `Found ${osmBoundaries.size} postcode boundaries in OSM` });
    } catch (err) {
      send({ progress: 30, message: `OSM fetch failed (${err.message}), using Voronoi fallback` });
    }

    // Step 2: fetch centroids for all London postcodes from postcodes.io
    send({ progress: 35, message: 'Fetching postcode centroids from postcodes.io...' });

    const LONDON_PREFIXES = [
      'E', 'EC', 'N', 'NW', 'SE', 'SW', 'W', 'WC',
      'BR', 'CR', 'DA', 'EN', 'HA', 'IG', 'KT', 'RM', 'SM', 'TW', 'UB',
    ];

    const allOutcodes = [];
    for (const prefix of LONDON_PREFIXES) {
      const max = prefix === 'EC' || prefix === 'WC' ? 4 : prefix === 'W' ? 14 :
                  prefix === 'SW' ? 20 : prefix === 'SE' ? 28 : prefix === 'N' ? 22 :
                  prefix === 'NW' ? 11 : prefix === 'E' ? 18 : 20;
      for (let i = 1; i <= max; i++) allOutcodes.push(`${prefix}${i}`);
    }

    const centroids = [];
    let fetched = 0;

    for (const outcode of allOutcodes) {
      try {
        const r = await fetch(`https://api.postcodes.io/outcodes/${outcode}`);
        if (!r.ok) { fetched++; continue; }
        const d = await r.json();
        if (!d.result?.latitude || !d.result?.longitude) { fetched++; continue; }

        const pt = turf.point([d.result.longitude, d.result.latitude]);
        try {
          if (!turf.booleanPointInPolygon(pt, LONDON_BOUNDARY)) { fetched++; continue; }
        } catch { fetched++; continue; }

        centroids.push({ postcode: outcode, lat: d.result.latitude, lng: d.result.longitude });
        fetched++;

        if (fetched % 10 === 0) {
          await new Promise(r => setTimeout(r, 50)); // Rate limit
          send({ progress: 35 + Math.round((fetched / allOutcodes.length) * 30), message: `Fetched ${fetched}/${allOutcodes.length} centroids...` });
        }
      } catch { fetched++; }
    }

    send({ progress: 65, message: `Got ${centroids.length} London postcode centroids` });

    // Step 3: for postcodes not in OSM, build Voronoi cells
    const missingCentroids = centroids.filter(c => !osmBoundaries.has(c.postcode));
    let voronoiBoundaries = new Map();

    if (missingCentroids.length > 0) {
      send({ progress: 70, message: `Building Voronoi boundaries for ${missingCentroids.length} postcodes not in OSM...` });
      // Build Voronoi across ALL centroids for better cell shapes, then filter
      voronoiBoundaries = buildVoronoiBoundaries(centroids, LONDON_BOUNDARY);
    }

    // Step 4: insert all boundaries
    send({ progress: 85, message: 'Saving boundaries to database...' });

    const insert = db.prepare(`
      INSERT OR IGNORE INTO postcode_boundaries (postcode, boundary, centroid_lat, centroid_lng)
      VALUES (?, ?, ?, ?)
    `);

    let added = 0;
    const insertAll = db.transaction(() => {
      for (const c of centroids) {
        const boundary = osmBoundaries.get(c.postcode) || voronoiBoundaries.get(c.postcode);
        if (!boundary) continue;

        insert.run(c.postcode, JSON.stringify(boundary.geometry), c.lat, c.lng);
        added++;
      }
    });
    insertAll();

    send({ progress: 100, done: true, total: added, message: `Setup complete: ${added} postcodes (${osmBoundaries.size} from OSM, ${added - osmBoundaries.size} from Voronoi)` });
    res.end();
  } catch (err) {
    console.error('Setup error:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: err.message });
    } else {
      res.end(JSON.stringify({ error: err.message }) + '\n');
    }
  }
});

// Reset and re-run setup
router.post('/reset', (req, res) => {
  db.prepare('DELETE FROM postcode_boundaries').run();
  db.prepare('DELETE FROM road_segments').run();
  db.prepare('DELETE FROM road_coverage').run();
  res.json({ ok: true });
});

// Get all postcode boundaries (for map)
router.get('/boundaries', (req, res) => {
  const boundaries = db.prepare(`
    SELECT postcode, boundary, centroid_lat, centroid_lng,
           total_roads, total_length_m, covered_length_m, coverage_pct, roads_fetched
    FROM postcode_boundaries
    ORDER BY coverage_pct DESC
  `).all();

  const geojson = {
    type: 'FeatureCollection',
    features: boundaries.map(b => ({
      type: 'Feature',
      properties: {
        postcode: b.postcode,
        totalRoads: b.total_roads,
        totalLength: b.total_length_m,
        coveredLength: b.covered_length_m,
        coveragePct: b.coverage_pct,
        roadsFetched: b.roads_fetched === 1,
      },
      geometry: JSON.parse(b.boundary),
    })),
  };

  res.json(geojson);
});

router.get('/status', (req, res) => {
  const count = db.prepare('SELECT COUNT(*) as count FROM postcode_boundaries').get();
  res.json({ initialized: count.count > 0, count: count.count });
});

export default router;
