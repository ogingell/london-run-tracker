import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

import stravaRoutes from './strava.js';
import osmRoutes from './osm.js';
import matcherRoutes from './matcher.js';
import postcodeRoutes from './postcodes.js';
import syncRoutes from './sync.js';
import placesRoutes from './places.js';
import roadsRoutes from './roads.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// API routes
app.use('/api', stravaRoutes);
app.use('/api', osmRoutes);
app.use('/api', matcherRoutes);
app.use('/api/postcodes', postcodeRoutes);
app.use('/api', syncRoutes);
app.use('/api/places', placesRoutes);
app.use('/api', roadsRoutes);

// Serve static files in production
const distPath = join(__dirname, '..', 'dist');
app.use(express.static(distPath));
app.get('*', (req, res) => {
  res.sendFile(join(distPath, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`\n  🏃 London Run Tracker API running on http://localhost:${PORT}\n`);
});
