const axios = require('axios');

async function fetchFmcsainfo(dot) {
  // FMCSA SAFER API endpoint for company snapshot by DOT number
  // Example: https://safer.fmcsa.dot.gov/query.asp?query_string=123456&query_type=DOT
  // We'll use the XML endpoint and parse the result
  const url = `https://safer.fmcsa.dot.gov/qa.asp?query_string=${dot}&query_type=DOT`;
  try {
    const response = await axios.get(url, { responseType: 'text' });
    return response.data;
  } catch (err) {
    throw new Error('Failed to fetch FMCSA data');
  }
}

module.exports = { fetchFmcsainfo };