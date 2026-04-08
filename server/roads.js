import { Router } from 'express';
import * as turf from '@turf/turf';
import db from './db.js';

const router = Router();

// Road detail for a postcode — simple direct lookup
router.get('/roads/postcode/:postcode', (req, res) => {
  const { postcode } = req.params;

  const boundary = db.prepare(
    'SELECT postcode, total_roads, total_length_m, covered_length_m, coverage_pct FROM postcode_boundaries WHERE postcode=?'
  ).get(postcode);
  if (!boundary) return res.status(404).json({ error: 'Not found' });

  const roads = db.prepare(`
    SELECT rs.id, rs.name, rs.highway_type, rs.length_m,
           COALESCE(rc.covered, 0)            AS covered,
           COALESCE(rc.covered_length_m, 0)   AS covered_length_m
    FROM road_segments rs
    LEFT JOIN road_coverage rc ON rc.road_segment_id = rs.id
    WHERE rs.postcode = ?
    ORDER BY rs.name ASC, rs.length_m DESC
  `).all(postcode);

  res.json({ ...boundary, roads });
});

// Road detail for a neighbourhood — filter postcode roads by centroid-in-polygon
router.get('/roads/place/:id', (req, res) => {
  const { id } = req.params;

  const place = db.prepare(
    'SELECT id, name, total_roads, total_length_m, covered_length_m, coverage_pct, boundary FROM places WHERE id=?'
  ).get(id);
  if (!place) return res.status(404).json({ error: 'Not found' });

  let placeGeo;
  try { placeGeo = turf.feature(JSON.parse(place.boundary)); } catch { return res.status(500).json({ error: 'Bad boundary' }); }

  const [minLng, minLat, maxLng, maxLat] = turf.bbox(placeGeo);

  // Load roads from fetched postcodes with coverage, pre-filtered by bbox
  const candidates = db.prepare(`
    SELECT rs.id, rs.name, rs.highway_type, rs.length_m,
           COALESCE(rc.covered, 0)            AS covered,
           COALESCE(rc.covered_length_m, 0)   AS covered_length_m,
           rs.geometry
    FROM road_segments rs
    LEFT JOIN road_coverage rc ON rc.road_segment_id = rs.id
    WHERE rs.postcode IN (SELECT postcode FROM postcode_boundaries WHERE roads_fetched=1)
  `).all();

  // Point-in-polygon filter using road centroid (same logic as computePlacesCoverage)
  const roads = [];
  for (const road of candidates) {
    try {
      const geom = JSON.parse(road.geometry);
      const c = turf.centroid(turf.feature(geom));
      const [cx, cy] = c.geometry.coordinates;
      if (cx < minLng || cx > maxLng || cy < minLat || cy > maxLat) continue;
      if (!turf.booleanPointInPolygon(c, placeGeo)) continue;
      const { geometry: _g, ...rest } = road; // strip geometry from response
      roads.push(rest);
    } catch {}
  }

  roads.sort((a, b) => a.name.localeCompare(b.name) || b.length_m - a.length_m);

  const { boundary: _b, ...placeInfo } = place;
  res.json({ ...placeInfo, roads });
});

export default router;
