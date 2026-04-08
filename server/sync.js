import { Router } from 'express';
import polyline from '@mapbox/polyline';
import * as turf from '@turf/turf';
import db from './db.js';
import { computePlacesCoverage } from './places.js';

const router = Router();

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
const MATCH_BUFFER_METERS = 25;

const RUNNABLE_HIGHWAYS = [
  'residential', 'tertiary', 'secondary', 'primary', 'unclassified',
  'living_street', 'pedestrian', 'footway', 'path', 'cycleway',
  'track', 'bridleway', 'steps', 'service',
];

const yield_ = () => new Promise(r => setImmediate(r));

function decodePolyline(encoded) {
  return polyline.decode(encoded).map(([lat, lng]) => [lng, lat]);
}

async function fetchRoadsForBbox(south, west, north, east) {
  const query = `[out:json][timeout:60];(way["highway"~"^(${RUNNABLE_HIGHWAYS.join('|')})$"](${south},${west},${north},${east}););out body;>;out skel qt;`;
  const res = await fetch(OVERPASS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `data=${encodeURIComponent(query)}`,
  });
  if (!res.ok) throw new Error(`Overpass error ${res.status}`);
  return res.json();
}

function osmToWays(data) {
  const nodes = new Map();
  for (const el of data.elements) {
    if (el.type === 'node') nodes.set(el.id, [el.lon, el.lat]);
  }
  const ways = [];
  for (const el of data.elements) {
    if (el.type === 'way' && el.tags?.highway) {
      const coords = el.nodes.map(n => nodes.get(n)).filter(Boolean);
      if (coords.length >= 2) {
        ways.push({ osmId: String(el.id), name: el.tags.name || 'Unnamed', highway: el.tags.highway, coords });
      }
    }
  }
  return ways;
}

async function storeRoads(ways, postcode, boundaryGeo) {
  const bbox = turf.bbox(boundaryGeo);
  const [west, south, east, north] = bbox;

  const insertRoad = db.prepare(`INSERT OR IGNORE INTO road_segments (id, osm_id, name, postcode, geometry, length_m, highway_type) VALUES (?, ?, ?, ?, ?, ?, ?)`);
  const insertCov = db.prepare(`INSERT OR IGNORE INTO road_coverage (road_segment_id, covered, covered_length_m) VALUES (?, 0, 0)`);

  let totalLength = 0;
  let count = 0;
  const batch = [];

  for (const way of ways) {
    const line = turf.lineString(way.coords);
    const centroid = turf.centroid(line);
    const [cx, cy] = centroid.geometry.coordinates;

    if (cx < west - 0.003 || cx > east + 0.003 || cy < south - 0.003 || cy > north + 0.003) continue;

    let inside = false;
    try { inside = turf.booleanPointInPolygon(centroid, boundaryGeo); } catch { inside = true; }
    if (!inside) continue;

    const length = turf.length(line, { units: 'meters' });
    batch.push({ id: `${postcode}_${way.osmId}`, osmId: way.osmId, name: way.name, highway: way.highway, geometry: JSON.stringify(line.geometry), length });
    totalLength += length;
    count++;
  }

  db.transaction(() => {
    for (const r of batch) {
      insertRoad.run(r.id, r.osmId, r.name, postcode, r.geometry, r.length, r.highway);
      insertCov.run(r.id);
    }
    db.prepare(`UPDATE postcode_boundaries SET roads_fetched=1, total_roads=?, total_length_m=? WHERE postcode=?`)
      .run(count, totalLength, postcode);
  })();

  return { count, totalLength };
}

// Rough London bounding box — skip activities outside it entirely
const LONDON_BBOX = { minLat: 51.20, maxLat: 51.75, minLng: -0.60, maxLng: 0.40 };

function isNearLondon(coords) {
  for (let i = 0; i < coords.length; i += 20) {
    const [lng, lat] = coords[i];
    if (lat >= LONDON_BBOX.minLat && lat <= LONDON_BBOX.maxLat &&
        lng >= LONDON_BBOX.minLng && lng <= LONDON_BBOX.maxLng) return true;
  }
  return false;
}

// Find which postcodes a single activity passes through (fast sampling)
function findPostcodesForActivity(activity, boundaries) {
  if (!activity.polyline) return [];
  const coords = decodePolyline(activity.polyline);
  if (!isNearLondon(coords)) return []; // skip runs outside London entirely
  const sample = coords.filter((_, idx) => idx % 20 === 0);
  const relevant = new Set();

  for (const [lng, lat] of sample) {
    const pt = turf.point([lng, lat]);
    for (const b of boundaries) {
      if (relevant.has(b.postcode)) continue;
      try {
        if (turf.booleanPointInPolygon(pt, JSON.parse(b.boundary))) relevant.add(b.postcode);
      } catch {}
    }
  }
  return Array.from(relevant);
}

// Match a batch of activities against multiple postcodes efficiently:
// Each activity is buffered ONCE and checked against all its relevant postcodes.
async function matchActivitiesMultiPostcode(activities, postcodeSets, send) {
  const allPostcodes = Array.from(postcodeSets.keys());
  if (!allPostcodes.length) return 0;

  // Pre-load roads + bboxes for all relevant postcodes
  const postcodeRoads = new Map();
  const postcodeBboxes = new Map();
  for (const postcode of allPostcodes) {
    const roads = db.prepare('SELECT id, geometry, length_m FROM road_segments WHERE postcode=?').all(postcode);
    postcodeRoads.set(postcode, roads);
    const row = db.prepare('SELECT boundary FROM postcode_boundaries WHERE postcode=?').get(postcode);
    if (row) postcodeBboxes.set(postcode, turf.bbox(JSON.parse(row.boundary)));
  }

  // Invert postcodeSets to: activityId -> Set<postcode>
  const activityPostcodes = new Map();
  for (const [postcode, acts] of postcodeSets) {
    for (const act of acts) {
      if (!activityPostcodes.has(act.id)) activityPostcodes.set(act.id, new Set());
      activityPostcodes.get(act.id).add(postcode);
    }
  }

  const roadCoverage = new Map(); // roadId -> max covered length
  const buf = 0.02;

  for (let i = 0; i < activities.length; i++) {
    const activity = activities[i];
    const myPostcodes = Array.from(activityPostcodes.get(activity.id) || []);
    if (!myPostcodes.length || !activity.polyline) continue;

    const name = (activity.name || 'Unnamed Run').substring(0, 45);
    send({ type: 'progress', message: `Matching run ${i + 1}/${activities.length}: ${name}`, done: i, total: activities.length, phase: 'match' });

    const coords = decodePolyline(activity.polyline);
    if (coords.length < 2) continue;

    // Buffer the activity ONCE — reused for all postcodes this run touches.
    // Simplify first to reduce vertex count (~1000 → ~50) for much faster buffering.
    let buffered;
    try {
      const line = turf.lineString(coords);
      const simplified = turf.simplify(line, { tolerance: 0.00015, highQuality: false });
      buffered = turf.buffer(simplified, MATCH_BUFFER_METERS, { units: 'meters', steps: 16 });
    } catch { continue; }
    if (!buffered) continue;

    for (const postcode of myPostcodes) {
      const bbox = postcodeBboxes.get(postcode);
      if (!bbox) continue;
      const [west, south, east, north] = bbox;

      // Quick bbox pre-filter: skip postcode if activity doesn't come near it
      let hasPoint = false;
      for (let j = 0; j < coords.length; j += 5) {
        const [lng, lat] = coords[j];
        if (lng >= west - buf && lng <= east + buf && lat >= south - buf && lat <= north + buf) { hasPoint = true; break; }
      }
      if (!hasPoint) continue;

      const roads = postcodeRoads.get(postcode) || [];
      for (const road of roads) {
        try {
          const roadGeom = JSON.parse(road.geometry);
          if (!turf.booleanIntersects(turf.feature(roadGeom), buffered)) continue;

          const tLine = turf.lineString(roadGeom.coordinates);
          const roadLen = turf.length(tLine, { units: 'meters' });
          const steps = Math.max(4, Math.ceil(roadLen / 20));
          let coveredSamples = 0;
          for (let s = 0; s <= steps; s++) {
            if (turf.booleanPointInPolygon(turf.along(tLine, (s / steps) * roadLen, { units: 'meters' }), buffered)) coveredSamples++;
          }
          const coveredLen = (coveredSamples / (steps + 1)) * roadLen;
          if (coveredLen > 0) roadCoverage.set(road.id, Math.max(roadCoverage.get(road.id) || 0, coveredLen));
        } catch {}
      }
    }

    if ((i + 1) % 3 === 0) await yield_();
  }

  // Write coverage — only upgrade existing values, never downgrade
  db.transaction(() => {
    const update = db.prepare(`UPDATE road_coverage SET covered=1, covered_length_m=? WHERE road_segment_id=? AND ?>covered_length_m`);
    for (const [id, len] of roadCoverage) update.run(len, id, len);
  })();

  // Recompute postcode stats from DB (accumulates all historical runs)
  for (const postcode of allPostcodes) {
    const stats = db.prepare(`
      SELECT SUM(rs.length_m) as total,
             SUM(CASE WHEN rc.covered=1 THEN MIN(rc.covered_length_m, rs.length_m) ELSE 0 END) as covered
      FROM road_segments rs
      LEFT JOIN road_coverage rc ON rc.road_segment_id=rs.id
      WHERE rs.postcode=?
    `).get(postcode);
    const pct = stats.total > 0 ? (stats.covered / stats.total) * 100 : 0;
    db.prepare(`UPDATE postcode_boundaries SET covered_length_m=?, coverage_pct=? WHERE postcode=?`)
      .run(stats.covered || 0, pct, postcode);
  }

  return roadCoverage.size;
}

// ── Delta sync — matches only new runs, uses pre-buffering for speed ──────────
router.post('/sync/full', async (req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' });
  const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  try {
    const newActivities = db.prepare(
      'SELECT id, name, polyline FROM activities WHERE polyline IS NOT NULL AND matched=0'
    ).all();

    if (newActivities.length === 0) {
      send({ type: 'done', message: 'All up to date — no new runs to match.' });
      res.end();
      return;
    }

    const fetchedBoundaries = db.prepare(
      'SELECT postcode, boundary FROM postcode_boundaries WHERE roads_fetched=1'
    ).all();

    if (fetchedBoundaries.length === 0) {
      send({ type: 'status', message: 'No road data loaded yet. Use the Globe button to run a Full London Scan first.' });
      send({ type: 'done', message: 'Tip: click Globe to load all London road data, then Sync to match your runs.' });
      res.end();
      return;
    }

    const runWord = newActivities.length === 1 ? 'run' : 'runs';
    send({ type: 'status', message: `${newActivities.length} new ${runWord} to match across ${fetchedBoundaries.length} loaded postcodes` });
    await yield_();

    // Phase 1: scan each run to find which postcodes it passes through
    const postcodeSets = new Map();
    for (let i = 0; i < newActivities.length; i++) {
      const activity = newActivities[i];
      const name = (activity.name || 'Unnamed Run').substring(0, 45);
      send({ type: 'progress', message: `Scanning run ${i + 1}/${newActivities.length}: ${name}`, done: i, total: newActivities.length, phase: 'scan' });

      const postcodes = findPostcodesForActivity(activity, fetchedBoundaries);
      for (const pc of postcodes) {
        if (!postcodeSets.has(pc)) postcodeSets.set(pc, []);
        postcodeSets.get(pc).push(activity);
      }
      if ((i + 1) % 5 === 0) await yield_();
    }

    const uniquePostcodes = Array.from(postcodeSets.keys());
    if (uniquePostcodes.length === 0) {
      db.prepare('UPDATE activities SET matched=1 WHERE matched=0').run();
      send({ type: 'done', message: 'New runs don\'t overlap any loaded postcodes (may be outside London).' });
      res.end();
      return;
    }

    send({ type: 'status', message: `Matching ${newActivities.length} ${runWord} across ${uniquePostcodes.length} postcodes...` });
    await yield_();

    // Phase 2: buffer each activity once, check all its postcodes
    const matched = await matchActivitiesMultiPostcode(newActivities, postcodeSets, send);

    db.prepare('UPDATE activities SET matched=1 WHERE matched=0').run();
    send({ type: 'progress', message: `Updating neighbourhood coverage...`, done: newActivities.length, total: newActivities.length, phase: 'match' });

    // Phase 3: derive place coverage from updated road data (fast, no Overpass)
    await computePlacesCoverage(send);

    send({ type: 'done', message: `Done! Matched ${newActivities.length} ${runWord}, ${matched} roads updated.` });
    res.end();
  } catch (err) {
    console.error('Sync error:', err);
    send({ type: 'error', message: err.message });
    res.end();
  }
});

// ── Full London scan — Phase 1: load all postcode roads
//                    — Phase 2: scan each run
//                    — Phase 3: match runs (pre-buffered, fast)
//                    — Phase 4: derive neighbourhood coverage
router.post('/sync/london', async (req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' });
  const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  try {
    const allBoundaries = db.prepare(
      'SELECT postcode, boundary, roads_fetched FROM postcode_boundaries ORDER BY postcode'
    ).all();
    const newActivities = db.prepare(
      'SELECT id, name, polyline FROM activities WHERE polyline IS NOT NULL AND matched=0'
    ).all();

    const notFetched = allBoundaries.filter(b => !b.roads_fetched);

    send({
      type: 'status',
      message: `Full scan: ${notFetched.length} postcodes to load, ${allBoundaries.length - notFetched.length} already cached`,
      total: allBoundaries.length,
      toFetch: notFetched.length,
    });

    if (notFetched.length > 0) {
      const estMinutes = Math.ceil((notFetched.length * 1.5) / 60);
      send({ type: 'status', message: `Est. ~${estMinutes} min to load roads. Progress is saved — safe to interrupt and resume.` });
    }

    // ── Phase 1: Fetch road data for uncached postcodes ──────────────────────
    let fetchDone = 0;
    for (const b of notFetched) {
      const boundaryGeo = JSON.parse(b.boundary);
      send({ type: 'progress', message: `Loading ${b.postcode} (${fetchDone + 1}/${notFetched.length})`, done: fetchDone, total: notFetched.length, phase: 'fetch' });

      try {
        const bbox = turf.bbox(boundaryGeo);
        const [west, south, east, north] = bbox;
        const osmData = await fetchRoadsForBbox(south - 0.001, west - 0.001, north + 0.001, east + 0.001);
        const ways = osmToWays(osmData);
        const { count } = await storeRoads(ways, b.postcode, boundaryGeo);
        fetchDone++;
        send({ type: 'progress', message: `✓ ${b.postcode} — ${count} roads (${fetchDone}/${notFetched.length})`, done: fetchDone, total: notFetched.length, postcode: b.postcode, phase: 'fetch' });
      } catch (err) {
        fetchDone++;
        send({ type: 'warn', message: `Skipped ${b.postcode}: ${err.message}` });
      }

      await new Promise(r => setTimeout(r, 1200));
      await yield_();
    }

    // ── Phase 2 + 3: Scan runs → match with pre-buffering ───────────────────
    if (newActivities.length === 0) {
      send({ type: 'status', message: 'All activities already matched.' });
    } else {
      const runWord = newActivities.length === 1 ? 'run' : 'runs';
      send({ type: 'status', message: `Scanning ${newActivities.length} unmatched ${runWord}...` });
      await yield_();

      const allFetchedBoundaries = db.prepare(
        'SELECT postcode, boundary FROM postcode_boundaries WHERE roads_fetched=1'
      ).all();
      const postcodeSets = new Map();

      for (let i = 0; i < newActivities.length; i++) {
        const activity = newActivities[i];
        const name = (activity.name || 'Unnamed Run').substring(0, 45);
        send({ type: 'progress', message: `Scanning run ${i + 1}/${newActivities.length}: ${name}`, done: i, total: newActivities.length, phase: 'scan' });

        const postcodes = findPostcodesForActivity(activity, allFetchedBoundaries);
        for (const pc of postcodes) {
          if (!postcodeSets.has(pc)) postcodeSets.set(pc, []);
          postcodeSets.get(pc).push(activity);
        }
        if ((i + 1) % 5 === 0) await yield_();
      }

      const uniquePostcodes = Array.from(postcodeSets.keys());
      send({ type: 'status', message: `Matching runs across ${uniquePostcodes.length} postcodes...` });
      await yield_();

      await matchActivitiesMultiPostcode(newActivities, postcodeSets, send);
      db.prepare('UPDATE activities SET matched=1 WHERE matched=0').run();
    }

    // ── Phase 4: Derive neighbourhood coverage ───────────────────────────────
    send({ type: 'status', message: 'Computing neighbourhood coverage...' });
    await computePlacesCoverage(send);

    const stats = db.prepare('SELECT COUNT(*) as fetched FROM postcode_boundaries WHERE roads_fetched=1').get();
    send({ type: 'done', message: `London scan complete! ${stats.fetched}/${allBoundaries.length} postcodes loaded.` });
    res.end();
  } catch (err) {
    console.error('London scan error:', err);
    send({ type: 'error', message: err.message });
    res.end();
  }
});

export default router;
