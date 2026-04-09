import { Router } from 'express';
import * as turf from '@turf/turf';
import db from './db.js';

const router = Router();

// For each newly-covered road, find which Voronoi place its postcode centroid falls in.
function computePlaceBreakdown(newRoads) {
  if (!newRoads.length) return [];

  const places = db.prepare(
    'SELECT id, name, boundary, coverage_pct, total_length_m FROM places WHERE boundary IS NOT NULL AND total_length_m > 0'
  ).all();
  if (!places.length) return [];

  // Unique postcodes among new roads
  const postcodes = [...new Set(newRoads.map(r => r.postcode))];
  const centroidRows = db.prepare(
    `SELECT postcode, centroid_lat, centroid_lng FROM postcode_boundaries WHERE postcode IN (${postcodes.map(() => '?').join(',')})`
  ).all(...postcodes);
  const centroidMap = {};
  for (const c of centroidRows) centroidMap[c.postcode] = [c.centroid_lng, c.centroid_lat];

  // Parse and bbox all place boundaries once
  const parsedPlaces = places.flatMap(p => {
    try {
      const geo = JSON.parse(p.boundary);
      return [{ ...p, geo, bbox: turf.bbox(geo) }];
    } catch { return []; }
  });

  const byPlaceMap = new Map();

  for (const road of newRoads) {
    const centroid = centroidMap[road.postcode];
    if (!centroid) continue;
    const [lng, lat] = centroid;
    const pt = turf.point(centroid);

    for (const p of parsedPlaces) {
      const [w, s, e, n] = p.bbox;
      if (lng < w || lng > e || lat < s || lat > n) continue;
      try {
        if (turf.booleanPointInPolygon(pt, p.geo)) {
          if (!byPlaceMap.has(p.id)) {
            byPlaceMap.set(p.id, {
              id: p.id, name: p.name,
              newRoads: 0, newDistanceM: 0,
              coverageAfter: p.coverage_pct,
              totalLengthM: p.total_length_m,
            });
          }
          const entry = byPlaceMap.get(p.id);
          entry.newRoads++;
          entry.newDistanceM += road.covered_length_m || road.length_m;
          break; // Voronoi cells are non-overlapping
        }
      } catch {}
    }
  }

  return [...byPlaceMap.values()]
    .map(p => {
      const delta = p.totalLengthM > 0 ? (p.newDistanceM / p.totalLengthM) * 100 : 0;
      return {
        id: p.id,
        name: p.name,
        newRoads: p.newRoads,
        newDistanceM: Math.round(p.newDistanceM),
        coverageAfter: p.coverageAfter,
        coverageBefore: Math.max(0, p.coverageAfter - delta),
        delta,
      };
    })
    .sort((a, b) => b.newDistanceM - a.newDistanceM);
}

function computePeriodStats(since, activityId = null) {
  let newRoads;
  if (activityId) {
    newRoads = db.prepare(`
      SELECT rs.id, rs.postcode, rs.length_m, rc.covered_length_m
      FROM road_coverage rc
      JOIN road_segments rs ON rs.id = rc.road_segment_id
      WHERE rc.first_covered_activity_id = ? AND rc.covered = 1
    `).all(activityId);
  } else {
    newRoads = db.prepare(`
      SELECT rs.id, rs.postcode, rs.length_m, rc.covered_length_m
      FROM road_coverage rc
      JOIN road_segments rs ON rs.id = rc.road_segment_id
      WHERE rc.first_covered_date >= ? AND rc.covered = 1
    `).all(since);
  }

  const activities = activityId
    ? db.prepare('SELECT id, name, distance, moving_time, start_date FROM activities WHERE id = ?').all(activityId)
    : db.prepare(`
        SELECT id, name, distance, moving_time, start_date
        FROM activities WHERE start_date >= ? AND matched = 1
        ORDER BY start_date DESC
      `).all(since);

  // Group by postcode
  const byPostcodeMap = new Map();
  for (const road of newRoads) {
    if (!byPostcodeMap.has(road.postcode)) {
      byPostcodeMap.set(road.postcode, { newRoads: 0, newDistanceM: 0 });
    }
    const e = byPostcodeMap.get(road.postcode);
    e.newRoads++;
    e.newDistanceM += road.covered_length_m || road.length_m;
  }

  const postcodeData = db.prepare(
    'SELECT postcode, coverage_pct, total_length_m FROM postcode_boundaries WHERE roads_fetched=1'
  ).all();
  const pMap = {};
  for (const p of postcodeData) pMap[p.postcode] = p;

  const byPostcode = [...byPostcodeMap.entries()]
    .map(([postcode, s]) => {
      const current = pMap[postcode] || { coverage_pct: 0, total_length_m: 1 };
      const delta = current.total_length_m > 0 ? (s.newDistanceM / current.total_length_m) * 100 : 0;
      return {
        postcode,
        newRoads: s.newRoads,
        newDistanceM: Math.round(s.newDistanceM),
        coverageAfter: current.coverage_pct,
        coverageBefore: Math.max(0, current.coverage_pct - delta),
        delta,
      };
    })
    .sort((a, b) => b.newDistanceM - a.newDistanceM);

  const byPlace = computePlaceBreakdown(newRoads);
  const totalNewDistance = Math.round(newRoads.reduce((s, r) => s + (r.covered_length_m || r.length_m), 0));

  return {
    activityCount: activities.length,
    activities,
    newRoads: newRoads.length,
    newDistanceM: totalNewDistance,
    byPostcode,
    byPlace,
  };
}

router.get('/progress/summary', (req, res) => {
  try {
    const now = new Date();
    const lastActivity = db.prepare(
      'SELECT id, start_date FROM activities WHERE matched=1 ORDER BY start_date DESC LIMIT 1'
    ).get();

    const since7  = new Date(now - 7  * 24 * 60 * 60 * 1000).toISOString();
    const since30 = new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString();

    res.json({
      lastRun:     lastActivity ? computePeriodStats(null, lastActivity.id) : null,
      days7:       computePeriodStats(since7),
      days30:      computePeriodStats(since30),
      lastRunDate: lastActivity?.start_date ?? null,
    });
  } catch (err) {
    console.error('Progress error:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
