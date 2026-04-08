import { Router } from 'express';
import polyline from '@mapbox/polyline';
import * as turf from '@turf/turf';
import db from './db.js';

const router = Router();

const MATCH_BUFFER_METERS = 25; // GPS accuracy buffer

function decodePolyline(encoded) {
  return polyline.decode(encoded).map(([lat, lng]) => [lng, lat]);
}

function matchActivityToRoads(activityCoords, roads) {
  if (activityCoords.length < 2) return [];

  const activityLine = turf.lineString(activityCoords);
  const buffered = turf.buffer(activityLine, MATCH_BUFFER_METERS, { units: 'meters' });

  if (!buffered) return [];

  const matches = [];

  for (const road of roads) {
    try {
      const roadGeom = JSON.parse(road.geometry);
      const roadLine = turf.feature(roadGeom);

      // Check if road intersects with activity buffer
      const intersects = turf.booleanIntersects(roadLine, buffered);

      if (intersects) {
        // Calculate how much of the road is covered
        let coveredLength = 0;
        const roadCoords = roadGeom.coordinates;

        // Sample points along the road and check if they're within buffer
        const roadTurfLine = turf.lineString(roadCoords);
        const roadLength = turf.length(roadTurfLine, { units: 'meters' });
        const numSamples = Math.max(5, Math.ceil(roadLength / 10));

        let coveredSamples = 0;
        for (let i = 0; i <= numSamples; i++) {
          const fraction = i / numSamples;
          const point = turf.along(roadTurfLine, fraction * roadLength, { units: 'meters' });
          if (turf.booleanPointInPolygon(point, buffered)) {
            coveredSamples++;
          }
        }

        coveredLength = (coveredSamples / (numSamples + 1)) * roadLength;

        if (coveredLength > 0) {
          matches.push({
            roadId: road.id,
            coveredLength,
            totalLength: roadLength,
          });
        }
      }
    } catch (err) {
      // Skip malformed roads
    }
  }

  return matches;
}

// Process coverage for a postcode
router.post('/match/:postcode', async (req, res) => {
  const { postcode } = req.params;

  try {
    // Get all activity polylines
    const activities = db.prepare(
      'SELECT id, polyline FROM activities WHERE polyline IS NOT NULL'
    ).all();

    if (!activities.length) {
      return res.json({ postcode, matched: 0, message: 'No activities to match' });
    }

    // Get all roads for this postcode
    const roads = db.prepare(
      'SELECT id, geometry, length_m FROM road_segments WHERE postcode = ?'
    ).all(postcode);

    if (!roads.length) {
      return res.json({ postcode, matched: 0, message: 'No roads fetched for this postcode' });
    }

    // Get postcode boundary for filtering activities
    const boundary = db.prepare(
      'SELECT boundary, centroid_lat, centroid_lng FROM postcode_boundaries WHERE postcode = ?'
    ).get(postcode);

    const boundaryGeo = JSON.parse(boundary.boundary);
    const bbox = turf.bbox(boundaryGeo);
    const [west, south, east, north] = bbox;
    const bboxBuffer = 0.02; // ~2km buffer

    // Track max coverage per road
    const roadCoverage = new Map();

    for (const activity of activities) {
      const coords = decodePolyline(activity.polyline);
      if (coords.length < 2) continue;

      // Quick bbox check - skip activities far from this postcode
      const actBbox = coords.reduce(
        (acc, [lng, lat]) => ({
          minLng: Math.min(acc.minLng, lng),
          maxLng: Math.max(acc.maxLng, lng),
          minLat: Math.min(acc.minLat, lat),
          maxLat: Math.max(acc.maxLat, lat),
        }),
        { minLng: Infinity, maxLng: -Infinity, minLat: Infinity, maxLat: -Infinity }
      );

      if (
        actBbox.maxLng < west - bboxBuffer ||
        actBbox.minLng > east + bboxBuffer ||
        actBbox.maxLat < south - bboxBuffer ||
        actBbox.minLat > north + bboxBuffer
      ) {
        continue;
      }

      const matches = matchActivityToRoads(coords, roads);

      for (const match of matches) {
        const existing = roadCoverage.get(match.roadId) || 0;
        roadCoverage.set(match.roadId, Math.max(existing, match.coveredLength));
      }
    }

    // Update database
    const updateCoverage = db.prepare(`
      UPDATE road_coverage SET covered = 1, covered_length_m = ?
      WHERE road_segment_id = ? AND ? > covered_length_m
    `);

    const updateAll = db.transaction(() => {
      for (const [roadId, coveredLength] of roadCoverage) {
        updateCoverage.run(coveredLength, roadId, coveredLength);
      }
    });

    updateAll();

    // Recalculate postcode stats
    const stats = db.prepare(`
      SELECT
        COUNT(*) as total_roads,
        SUM(rs.length_m) as total_length,
        SUM(CASE WHEN rc.covered = 1 THEN MIN(rc.covered_length_m, rs.length_m) ELSE 0 END) as covered_length
      FROM road_segments rs
      LEFT JOIN road_coverage rc ON rc.road_segment_id = rs.id
      WHERE rs.postcode = ?
    `).get(postcode);

    const coveragePct = stats.total_length > 0
      ? (stats.covered_length / stats.total_length) * 100
      : 0;

    db.prepare(`
      UPDATE postcode_boundaries
      SET covered_length_m = ?, coverage_pct = ?
      WHERE postcode = ?
    `).run(stats.covered_length || 0, coveragePct, postcode);

    res.json({
      postcode,
      matched: roadCoverage.size,
      totalRoads: stats.total_roads,
      coveragePct: Math.round(coveragePct * 100) / 100,
    });
  } catch (err) {
    console.error(`Match error for ${postcode}:`, err);
    res.status(500).json({ error: err.message });
  }
});

// Get overall stats — uses pre-computed values from postcode_boundaries (fast, no joins)
router.get('/stats', (req, res) => {
  const postcodes = db.prepare(`
    SELECT postcode, total_roads, total_length_m, covered_length_m, coverage_pct, roads_fetched
    FROM postcode_boundaries
    ORDER BY roads_fetched DESC, coverage_pct DESC, postcode ASC
  `).all();

  const totals = db.prepare(`
    SELECT
      COALESCE(SUM(total_roads), 0) as total_roads,
      COALESCE(SUM(total_length_m), 0) as total_length,
      COALESCE(SUM(covered_length_m), 0) as covered_length
    FROM postcode_boundaries
    WHERE roads_fetched = 1
  `).get();

  const activityCount = db.prepare('SELECT COUNT(*) as count FROM activities').get();
  const totalDistance = db.prepare('SELECT COALESCE(SUM(distance), 0) as total FROM activities').get();

  res.json({
    postcodes,
    totals: {
      ...totals,
      coveragePct: totals.total_length > 0
        ? Math.round((totals.covered_length / totals.total_length) * 10000) / 100
        : 0,
    },
    activityCount: activityCount.count,
    totalDistance: totalDistance.total,
  });
});

export default router;
