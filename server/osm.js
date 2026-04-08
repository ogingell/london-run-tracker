import { Router } from 'express';
import * as turf from '@turf/turf';
import db from './db.js';

const router = Router();

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';

const RUNNABLE_HIGHWAY_TYPES = [
  'residential', 'tertiary', 'secondary', 'primary', 'unclassified',
  'living_street', 'pedestrian', 'footway', 'path', 'cycleway',
  'track', 'bridleway', 'steps', 'service',
];

async function fetchRoadsForBbox(south, west, north, east) {
  const highwayFilter = RUNNABLE_HIGHWAY_TYPES.map(t => `["highway"="${t}"]`).join('');
  const query = `
    [out:json][timeout:120];
    (
      way["highway"~"^(${RUNNABLE_HIGHWAY_TYPES.join('|')})$"](${south},${west},${north},${east});
    );
    out body;
    >;
    out skel qt;
  `;

  const res = await fetch(OVERPASS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `data=${encodeURIComponent(query)}`,
  });

  if (!res.ok) {
    throw new Error(`Overpass API error: ${res.status}`);
  }

  return res.json();
}

function osmToGeoJSON(data) {
  const nodes = new Map();
  const ways = [];

  for (const el of data.elements) {
    if (el.type === 'node') {
      nodes.set(el.id, [el.lon, el.lat]);
    }
  }

  for (const el of data.elements) {
    if (el.type === 'way' && el.tags?.highway) {
      const coords = el.nodes
        .map(nid => nodes.get(nid))
        .filter(Boolean);

      if (coords.length >= 2) {
        ways.push({
          osmId: String(el.id),
          name: el.tags.name || 'Unnamed Road',
          highway: el.tags.highway,
          coords,
        });
      }
    }
  }

  return ways;
}

// Fetch roads for a specific postcode district
router.post('/roads/fetch/:postcode', async (req, res) => {
  const { postcode } = req.params;

  try {
    const boundary = db.prepare(
      'SELECT * FROM postcode_boundaries WHERE postcode = ?'
    ).get(postcode);

    if (!boundary) {
      return res.status(404).json({ error: 'Postcode not found' });
    }

    if (boundary.roads_fetched) {
      const count = db.prepare(
        'SELECT COUNT(*) as count FROM road_segments WHERE postcode = ?'
      ).get(postcode);
      return res.json({ postcode, roads: count.count, cached: true });
    }

    const boundaryGeo = JSON.parse(boundary.boundary);
    const bbox = turf.bbox(boundaryGeo);
    const [west, south, east, north] = bbox;

    // Add small buffer
    const buffer = 0.001;
    const osmData = await fetchRoadsForBbox(
      south - buffer, west - buffer, north + buffer, east + buffer
    );

    const ways = osmToGeoJSON(osmData);

    const insertRoad = db.prepare(`
      INSERT OR IGNORE INTO road_segments (id, osm_id, name, postcode, geometry, length_m, highway_type)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const insertCoverage = db.prepare(`
      INSERT OR IGNORE INTO road_coverage (road_segment_id, covered, covered_length_m)
      VALUES (?, 0, 0)
    `);

    let totalLength = 0;
    let roadCount = 0;

    const insertAll = db.transaction(() => {
      for (const way of ways) {
        const line = turf.lineString(way.coords);
        const centroid = turf.centroid(line);

        // Check if road centroid is within the postcode boundary
        let isInside = false;
        try {
          isInside = turf.booleanPointInPolygon(centroid, boundaryGeo);
        } catch {
          // If boundary check fails, use bbox containment
          const [cx, cy] = centroid.geometry.coordinates;
          isInside = cx >= west && cx <= east && cy >= south && cy <= north;
        }

        if (isInside) {
          const length = turf.length(line, { units: 'meters' });
          const id = `${postcode}_${way.osmId}`;
          const geometry = JSON.stringify(line.geometry);

          insertRoad.run(id, way.osmId, way.name, postcode, geometry, length, way.highway);
          insertCoverage.run(id);
          totalLength += length;
          roadCount++;
        }
      }

      db.prepare(`
        UPDATE postcode_boundaries
        SET roads_fetched = 1, total_roads = ?, total_length_m = ?
        WHERE postcode = ?
      `).run(roadCount, totalLength, postcode);
    });

    insertAll();

    res.json({ postcode, roads: roadCount, totalLength, cached: false });
  } catch (err) {
    console.error(`Error fetching roads for ${postcode}:`, err);
    res.status(500).json({ error: err.message });
  }
});

// Get roads for a postcode
router.get('/roads/:postcode', (req, res) => {
  const { postcode } = req.params;
  const roads = db.prepare(`
    SELECT rs.id, rs.name, rs.geometry, rs.length_m, rs.highway_type,
           COALESCE(rc.covered, 0) as covered,
           COALESCE(rc.covered_length_m, 0) as covered_length_m
    FROM road_segments rs
    LEFT JOIN road_coverage rc ON rc.road_segment_id = rs.id
    WHERE rs.postcode = ?
  `).all(postcode);
  res.json(roads);
});

export default router;
export { fetchRoadsForBbox, osmToGeoJSON };
