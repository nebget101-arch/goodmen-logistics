const express = require('express');
const axios = require('axios');
const router = express.Router();
const { query } = require('../internal/db');

async function zipTableExists() {
  try {
    const result = await query(`SELECT to_regclass('public.zip_codes') as reg`);
    return !!result.rows[0]?.reg;
  } catch {
    return false;
  }
}

/**
 * @openapi
 * /api/geo/route:
 *   get:
 *     summary: Get driving route between waypoints
 *     description: Proxies the OSRM routing service to avoid browser CORS restrictions. Accepts semicolon-separated waypoints as lon,lat pairs and returns the full GeoJSON route geometry.
 *     tags:
 *       - Geo
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: waypoints
 *         required: true
 *         schema:
 *           type: string
 *         description: Semicolon-separated lon,lat pairs (e.g. "-87.6298,41.8781;-73.9857,40.7484")
 *     responses:
 *       200:
 *         description: Route geometry
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   nullable: true
 *                   properties:
 *                     coordinates:
 *                       type: array
 *                       items:
 *                         type: array
 *                         items:
 *                           type: number
 *       400:
 *         description: Missing waypoints parameter
 *       502:
 *         description: OSRM service unavailable
 */
router.get('/route', async (req, res) => {
  const waypoints = (req.query.waypoints || '').toString().trim();
  if (!waypoints) {
    return res.status(400).json({ success: false, error: 'waypoints query is required (lon1,lat1;lon2,lat2)' });
  }
  try {
    const url = `https://router.project-osrm.org/route/v1/driving/${encodeURIComponent(waypoints)}?overview=full&geometries=geojson`;
    const response = await axios.get(url);
    const coords = response.data?.routes?.[0]?.geometry?.coordinates;
    if (!coords || !Array.isArray(coords)) {
      return res.json({ success: true, data: null });
    }
    return res.json({ success: true, data: { coordinates: coords } });
  } catch (err) {
    console.error('OSRM route proxy error:', err.message || err);
    return res.status(502).json({ success: false, error: 'Route service unavailable' });
  }
});

/**
 * @openapi
 * /api/geo/zip/{zip}:
 *   get:
 *     summary: Lookup city, state, and coordinates by ZIP code
 *     description: Resolves a US ZIP code to city, state, latitude, and longitude. Uses a local zip_codes cache table when available, falling back to the Zippopotam.us API. Backfills missing lat/lon into the cache.
 *     tags:
 *       - Geo
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: zip
 *         required: true
 *         schema:
 *           type: string
 *         description: US ZIP code (e.g. "60601")
 *     responses:
 *       200:
 *         description: ZIP code details
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     zip:
 *                       type: string
 *                     city:
 *                       type: string
 *                     state:
 *                       type: string
 *                     lat:
 *                       type: number
 *                     lon:
 *                       type: number
 *       400:
 *         description: ZIP is required
 *       404:
 *         description: ZIP not found
 *       500:
 *         description: Server error
 */
router.get('/zip/:zip', async (req, res) => {
  const zip = (req.params.zip || '').toString().trim();
  if (!zip) {
    return res.status(400).json({ success: false, error: 'ZIP is required' });
  }

  try {
    const hasZipTable = await zipTableExists();
    if (hasZipTable) {
      const cached = await query(
        'SELECT city, state, latitude, longitude FROM zip_codes WHERE zip = $1',
        [zip]
      );
      if (cached.rows.length > 0) {
        const row = cached.rows[0];
        let lat = row.latitude != null ? parseFloat(row.latitude) : null;
        let lon = row.longitude != null ? parseFloat(row.longitude) : null;
        if ((lat == null || Number.isNaN(lat) || lon == null || Number.isNaN(lon))) {
          try {
            const zippo = await axios.get(`https://api.zippopotam.us/us/${encodeURIComponent(zip)}`);
            const place = zippo.data?.places?.[0];
            if (place?.latitude != null && place?.longitude != null) {
              lat = parseFloat(place.latitude);
              lon = parseFloat(place.longitude);
              await query(
                'UPDATE zip_codes SET latitude = $2, longitude = $3 WHERE zip = $1',
                [zip, lat, lon]
              );
            }
          } catch (_) {
            /* keep lat/lon null */
          }
        }
        const data = { zip, city: row.city, state: row.state };
        if (lat != null && !Number.isNaN(lat) && lon != null && !Number.isNaN(lon)) {
          data.lat = lat;
          data.lon = lon;
        }
        return res.json({ success: true, data });
      }
    }

    const response = await axios.get(`https://api.zippopotam.us/us/${encodeURIComponent(zip)}`);
    const place = response.data?.places?.[0];
    if (!place) {
      return res.status(404).json({ success: false, error: 'ZIP not found' });
    }

    const city = place['place name'];
    const state = place['state abbreviation'];
    const lat = place.latitude != null ? parseFloat(place.latitude) : null;
    const lon = place.longitude != null ? parseFloat(place.longitude) : null;

    if (hasZipTable) {
      await query(
        `INSERT INTO zip_codes (zip, city, state, latitude, longitude)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (zip) DO UPDATE SET
           city = EXCLUDED.city,
           state = EXCLUDED.state,
           latitude = COALESCE(EXCLUDED.latitude, zip_codes.latitude),
           longitude = COALESCE(EXCLUDED.longitude, zip_codes.longitude)`,
        [zip, city, state, lat, lon]
      );
    }

    const data = { zip, city, state };
    if (lat != null && !Number.isNaN(lat) && lon != null && !Number.isNaN(lon)) {
      data.lat = lat;
      data.lon = lon;
    }
    res.json({ success: true, data });
  } catch (error) {
    if (error.response?.status === 404) {
      return res.status(404).json({ success: false, error: 'ZIP not found' });
    }
    console.error('Error fetching zip:', error);
    res.status(500).json({ success: false, error: 'Failed to lookup ZIP' });
  }
});

module.exports = router;
