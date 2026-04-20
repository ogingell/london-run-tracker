import { Router } from 'express';
import * as turf from '@turf/turf';
import db from './db.js';

const router = Router();

const SHADOW_DISTANCE_M = 15;  // unnamed footway within 15m of a named road = pavement duplicate
const MIN_SEGMENT_M = 40;       // drop micro-fragments (junction slivers, < 40m)

// Deduplicate road segments:
// 1. Drop micro-fragments < 20m (OSM junction slivers that add noise)
// 2. Drop unnamed footways/paths/steps/cycleways that shadow a named road within 15m
// Each surviving segment is returned as-is — no name-based grouping
// (same named road split by OSM stays as separate clickable segments)
function deduplicate(segments) {
  if (!segments.length) return [];

  // Drop micro-fragments first
  const nonTiny = segments.filter(r => r.length_m >= MIN_SEGMENT_M);

  const named   = nonTiny.filter(r => r.name !== 'Unnamed');
  const unnamed = nonTiny.filter(r => r.name === 'Unnamed');
  const SECONDARY_TYPES = new Set(['footway', 'path', 'steps', 'cycleway', 'bridleway']);

  // Build turf lineStrings for all named roads (used for nearestPointOnLine checks)
  const namedLines = named.map(r => {
    try { return turf.lineString(JSON.parse(r.geometry).coordinates); } catch { return null; }
  }).filter(Boolean);

  // Keep unnamed secondary types only if they're not shadowing a named road.
  // Sample 5 points along the unnamed segment; if >50% are within SHADOW_DISTANCE_M
  // of ANY named road line, treat it as a pavement duplicate and drop it.
  const filteredUnnamed = unnamed.filter(r => {
    if (!SECONDARY_TYPES.has(r.highway_type)) return true;
    try {
      const coords = JSON.parse(r.geometry).coordinates;
      const line = turf.lineString(coords);
      const len = turf.length(line, { units: 'meters' });
      const SAMPLES = 5;
      let closeSamples = 0;
      for (let i = 0; i <= SAMPLES; i++) {
        const pt = turf.along(line, (i / SAMPLES) * len, { units: 'meters' });
        const isShadow = namedLines.some(nl => {
          const nearest = turf.nearestPointOnLine(nl, pt, { units: 'meters' });
          return nearest.properties.dist < SHADOW_DISTANCE_M;
        });
        if (isShadow) closeSamples++;
      }
      // Drop if majority of samples shadow a named road
      return closeSamples <= SAMPLES / 2;
    } catch { return true; }
  });

  return [...named, ...filteredUnnamed].map(r => ({
    name: r.name,
    highway_type: r.highway_type,
    total_length_m: r.length_m,
    covered_length_m: r.covered_length_m,
    covered: r.covered === 1 || r.covered === true,
    geometry: r.geometry,
  }));
}

// Road detail for a postcode
router.get('/roads/postcode/:postcode', (req, res) => {
  const { postcode } = req.params;

  const boundary = db.prepare(
    'SELECT postcode, total_roads, total_length_m, covered_length_m, coverage_pct, roads_fetched FROM postcode_boundaries WHERE postcode=?'
  ).get(postcode);
  if (!boundary) return res.status(404).json({ error: 'Not found' });

  const segments = db.prepare(`
    SELECT rs.id, rs.name, rs.highway_type, rs.length_m, rs.geometry,
           COALESCE(rc.covered, 0)            AS covered,
           COALESCE(rc.covered_length_m, 0)   AS covered_length_m
    FROM road_segments rs
    LEFT JOIN road_coverage rc ON rc.road_segment_id = rs.id
    WHERE rs.postcode = ?
  `).all(postcode);

  const roads = deduplicate(segments);
  res.json({ ...boundary, roads });
});

// Road detail for a neighbourhood
router.get('/roads/place/:id', (req, res) => {
  const { id } = req.params;

  const place = db.prepare(
    'SELECT id, name, total_roads, total_length_m, covered_length_m, coverage_pct, boundary FROM places WHERE id=?'
  ).get(id);
  if (!place) return res.status(404).json({ error: 'Not found' });

  let placeGeo;
  try { placeGeo = turf.feature(JSON.parse(place.boundary)); } catch { return res.status(500).json({ error: 'Bad boundary' }); }

  const [minLng, minLat, maxLng, maxLat] = turf.bbox(placeGeo);

  const candidates = db.prepare(`
    SELECT rs.id, rs.name, rs.highway_type, rs.length_m, rs.geometry,
           COALESCE(rc.covered, 0)            AS covered,
           COALESCE(rc.covered_length_m, 0)   AS covered_length_m
    FROM road_segments rs
    LEFT JOIN road_coverage rc ON rc.road_segment_id = rs.id
    WHERE rs.postcode IN (SELECT postcode FROM postcode_boundaries WHERE roads_fetched=1)
  `).all();

  const inBounds = [];
  for (const road of candidates) {
    try {
      const geom = JSON.parse(road.geometry);
      const c = turf.centroid(turf.feature(geom));
      const [cx, cy] = c.geometry.coordinates;
      if (cx < minLng || cx > maxLng || cy < minLat || cy > maxLat) continue;
      if (!turf.booleanPointInPolygon(c, placeGeo)) continue;
      inBounds.push(road);
    } catch {}
  }

  const roads = deduplicate(inBounds);
  const { boundary: _b, ...placeInfo } = place;
  res.json({ ...placeInfo, roads });
});

export default router;
