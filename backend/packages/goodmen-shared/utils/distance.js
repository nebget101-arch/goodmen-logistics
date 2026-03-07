const axios = require('axios');

async function lookupZipLatLon(zip) {
  const trimmed = (zip || '').toString().trim();
  if (!trimmed) return null;
  try {
    const response = await axios.get(`https://api.zippopotam.us/us/${encodeURIComponent(trimmed)}`);
    const place = response.data?.places?.[0];
    if (!place) return null;
    const lat = parseFloat(place.latitude);
    const lon = parseFloat(place.longitude);
    if (Number.isNaN(lat) || Number.isNaN(lon)) return null;
    return { lat, lon };
  } catch (err) {
    return null;
  }
}

async function getDrivingDistanceMiles(fromZip, toZip) {
  const from = await lookupZipLatLon(fromZip);
  const to = await lookupZipLatLon(toZip);
  if (!from || !to) return 0;
  try {
    const url = `https://router.project-osrm.org/route/v1/driving/${from.lon},${from.lat};${to.lon},${to.lat}?overview=false`;
    const response = await axios.get(url);
    const meters = response.data?.routes?.[0]?.distance;
    if (typeof meters !== 'number' || meters <= 0) return 0;
    return Math.round(meters / 1609.34);
  } catch (err) {
    return 0;
  }
}

module.exports = { lookupZipLatLon, getDrivingDistanceMiles };
