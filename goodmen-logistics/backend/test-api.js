const http = require('http');

http.get('http://localhost:3000/api/drivers', (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    const drivers = JSON.parse(data);
    console.log(`Total drivers: ${drivers.length}\n`);
    console.log('First driver:');
    console.log(JSON.stringify(drivers[0], null, 2));
  });
}).on('error', err => console.error('Error:', err.message));
