const http = require('http');

setTimeout(() => {
  http.get('http://localhost:3000/api/drivers', (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
      try {
        const drivers = JSON.parse(data);
        console.log(`✅ API returned ${drivers.length} drivers\n`);
        if (drivers.length > 0) {
          console.log('First driver sample:');
          console.log(JSON.stringify(drivers[0], null, 2).substring(0, 600));
        }
      } catch (error) {
        console.error('❌ Error parsing response:', error.message);
        console.log('Raw response:', data.substring(0, 200));
      }
      process.exit(0);
    });
  }).on('error', err => {
    console.error('❌ API Error:', err.message);
    process.exit(1);
  });
}, 3000);

console.log('Waiting 3 seconds for server to be ready...');
