import { Router } from 'express';
import db from './db.js';

const router = Router();

const STRAVA_AUTH_URL = 'https://www.strava.com/oauth/authorize';
const STRAVA_TOKEN_URL = 'https://www.strava.com/oauth/token';
const STRAVA_API_URL = 'https://www.strava.com/api/v3';
const REDIRECT_URI = process.env.STRAVA_REDIRECT_URI || 'http://localhost:5173/api/auth/callback';

function getCredentials() {
  const clientId = process.env.STRAVA_CLIENT_ID;
  const clientSecret = process.env.STRAVA_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('STRAVA_CLIENT_ID and STRAVA_CLIENT_SECRET must be set in .env');
  }
  return { clientId, clientSecret };
}

function getStoredToken() {
  return db.prepare('SELECT * FROM tokens WHERE id = 1').get();
}

async function refreshTokenIfNeeded() {
  const token = getStoredToken();
  if (!token) return null;

  const now = Math.floor(Date.now() / 1000);
  if (token.expires_at > now + 60) {
    return token.access_token;
  }

  const { clientId, clientSecret } = getCredentials();
  const res = await fetch(STRAVA_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'refresh_token',
      refresh_token: token.refresh_token,
    }),
  });

  if (!res.ok) throw new Error('Failed to refresh token');
  const data = await res.json();

  db.prepare(`
    UPDATE tokens SET access_token = ?, refresh_token = ?, expires_at = ? WHERE id = 1
  `).run(data.access_token, data.refresh_token, data.expires_at);

  return data.access_token;
}

async function stravaFetch(path, accessToken) {
  const res = await fetch(`${STRAVA_API_URL}${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Strava API error ${res.status}: ${text}`);
  }
  return res.json();
}

// Auth status
router.get('/auth/status', (req, res) => {
  const token = getStoredToken();
  if (token) {
    res.json({
      connected: true,
      athlete: { id: token.athlete_id, name: token.athlete_name },
    });
  } else {
    res.json({ connected: false });
  }
});

// Start OAuth flow
router.get('/auth/login', (req, res) => {
  const { clientId } = getCredentials();
  const url = `${STRAVA_AUTH_URL}?client_id=${clientId}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=read,activity:read_all`;
  res.json({ url });
});

// OAuth callback
router.get('/auth/callback', async (req, res) => {
  const { code } = req.query;
  if (!code) return res.status(400).json({ error: 'No code provided' });

  try {
    const { clientId, clientSecret } = getCredentials();
    const tokenRes = await fetch(STRAVA_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        grant_type: 'authorization_code',
      }),
    });

    if (!tokenRes.ok) throw new Error('Token exchange failed');
    const data = await tokenRes.json();

    db.prepare(`
      INSERT OR REPLACE INTO tokens (id, access_token, refresh_token, expires_at, athlete_id, athlete_name)
      VALUES (1, ?, ?, ?, ?, ?)
    `).run(
      data.access_token,
      data.refresh_token,
      data.expires_at,
      data.athlete.id,
      `${data.athlete.firstname} ${data.athlete.lastname}`
    );

    res.redirect('/?connected=true');
  } catch (err) {
    console.error('Auth error:', err);
    res.redirect('/?error=auth_failed');
  }
});

// Disconnect
router.post('/auth/disconnect', (req, res) => {
  db.prepare('DELETE FROM tokens').run();
  db.prepare('DELETE FROM activities').run();
  // Reset coverage stats but keep road_segments + road_coverage rows intact
  // (road geometry is expensive to re-fetch; just zero the covered values)
  db.prepare('UPDATE road_coverage SET covered=0, covered_length_m=0').run();
  db.prepare('UPDATE postcode_boundaries SET covered_length_m=0, coverage_pct=0').run();
  db.prepare('UPDATE places SET covered_length_m=0, coverage_pct=0, roads_fetched=CASE WHEN total_roads>0 THEN 1 ELSE 0 END').run();
  res.json({ ok: true });
});

// Fetch activities from Strava
router.post('/activities/sync', async (req, res) => {
  try {
    const accessToken = await refreshTokenIfNeeded();
    if (!accessToken) return res.status(401).json({ error: 'Not connected' });

    let page = 1;
    let allActivities = [];
    const existingIds = new Set(
      db.prepare('SELECT id FROM activities').all().map(r => r.id)
    );

    while (true) {
      const activities = await stravaFetch(
        `/athlete/activities?per_page=100&page=${page}`,
        accessToken
      );
      if (!activities.length) break;

      const runs = activities.filter(
        a => a.type === 'Run' && a.map?.summary_polyline
      );

      for (const run of runs) {
        if (existingIds.has(String(run.id))) continue;
        allActivities.push(run);
      }

      page++;
      if (activities.length < 100) break;
    }

    const insert = db.prepare(`
      INSERT OR IGNORE INTO activities (id, name, distance, moving_time, start_date, polyline, start_lat, start_lng)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertMany = db.transaction((activities) => {
      for (const a of activities) {
        insert.run(
          String(a.id),
          a.name,
          a.distance,
          a.moving_time,
          a.start_date,
          a.map.summary_polyline,
          a.start_latlng?.[0] || null,
          a.start_latlng?.[1] || null
        );
      }
    });

    insertMany(allActivities);

    const total = db.prepare('SELECT COUNT(*) as count FROM activities').get();

    res.json({
      synced: allActivities.length,
      total: total.count,
    });
  } catch (err) {
    console.error('Sync error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Get activities
router.get('/activities', (req, res) => {
  const activities = db.prepare(
    'SELECT id, name, distance, moving_time, start_date, start_lat, start_lng FROM activities ORDER BY start_date DESC'
  ).all();
  res.json(activities);
});

// Get activity polylines for map display
router.get('/activities/polylines', (req, res) => {
  const activities = db.prepare(
    'SELECT id, polyline FROM activities WHERE polyline IS NOT NULL'
  ).all();
  res.json(activities);
});

export default router;
export { refreshTokenIfNeeded, stravaFetch };
