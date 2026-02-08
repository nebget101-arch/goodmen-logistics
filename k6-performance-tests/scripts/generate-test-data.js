/**
 * Advanced Test Data Generator using Faker
 * 
 * Generates realistic test data for performance testing.
 * Can be used to pre-populate test data or generate JSON files.
 * 
 * Usage:
 *   node scripts/generate-test-data.js --drivers=100
 *   node scripts/generate-test-data.js --vehicles=50 --output=test-data.json
 *   node scripts/generate-test-data.js --populate (creates data in backend)
 */

const { faker } = require('@faker-js/faker');
const axios = require('axios');
const fs = require('fs');

const TEST_DATA_PREFIX = 'TEST_DATA_';
const BASE_URL = process.env.BASE_URL || 'https://safetyapp-ln58.onrender.com';

// Parse command line arguments
function parseArgs() {
  const args = {
    drivers: 10,
    vehicles: 10,
    hos: 20,
    output: null,
    populate: false,
  };
  
  process.argv.forEach(arg => {
    if (arg.startsWith('--drivers=')) args.drivers = parseInt(arg.split('=')[1]);
    if (arg.startsWith('--vehicles=')) args.vehicles = parseInt(arg.split('=')[1]);
    if (arg.startsWith('--hos=')) args.hos = parseInt(arg.split('=')[1]);
    if (arg.startsWith('--output=')) args.output = arg.split('=')[1];
    if (arg === '--populate') args.populate = true;
  });
  
  return args;
}

class TestDataGenerator {
  constructor() {
    this.generatedDriverIds = [];
    this.generatedVehicleIds = [];
  }

  generateDriver() {
    const firstName = `${TEST_DATA_PREFIX}${faker.person.firstName()}`;
    const lastName = faker.person.lastName();
    const states = ['CA', 'TX', 'FL', 'NY', 'IL', 'PA', 'OH', 'GA', 'NC', 'MI'];
    
    return {
      firstName,
      lastName,
      email: `${TEST_DATA_PREFIX.toLowerCase()}${faker.internet.email({ firstName: firstName.replace(TEST_DATA_PREFIX, ''), lastName })}`,
      phone: faker.phone.number('555-###-####'),
      cdlNumber: `${TEST_DATA_PREFIX}${faker.string.alphanumeric(10).toUpperCase()}`,
      cdlState: faker.helpers.arrayElement(states),
      cdlClass: faker.helpers.arrayElement(['A', 'B', 'C']),
      address: `${faker.location.streetAddress()}, ${faker.location.city()}, ${faker.helpers.arrayElement(states)} ${faker.location.zipCode()}`,
      dateOfBirth: faker.date.birthdate({ min: 21, max: 65, mode: 'age' }).toISOString().split('T')[0],
      hireDate: faker.date.past({ years: 5 }).toISOString().split('T')[0],
      status: faker.helpers.arrayElement(['active', 'inactive', 'on-leave']),
    };
  }

  generateVehicle() {
    const makes = ['Freightliner', 'Kenworth', 'Peterbilt', 'Volvo', 'International', 'Mack'];
    const models = {
      'Freightliner': ['Cascadia', 'M2 106', 'Century Class'],
      'Kenworth': ['T680', 'T880', 'W900'],
      'Peterbilt': ['579', '389', '567'],
      'Volvo': ['VNL', 'VNR', 'VHD'],
      'International': ['LT', 'RH', 'HV'],
      'Mack': ['Anthem', 'Pinnacle', 'Granite'],
    };
    const states = ['CA', 'TX', 'FL', 'NY', 'IL', 'PA', 'OH', 'GA', 'NC', 'MI'];
    
    const make = faker.helpers.arrayElement(makes);
    const model = faker.helpers.arrayElement(models[make]);
    
    return {
      unit: `${TEST_DATA_PREFIX}${faker.string.alphanumeric(6).toUpperCase()}`,
      make,
      model,
      year: faker.number.int({ min: 2015, max: 2024 }),
      vin: `${TEST_DATA_PREFIX}${faker.vehicle.vin()}`,
      licensePlate: `${TEST_DATA_PREFIX}${faker.string.alphanumeric(7).toUpperCase()}`,
      licensePlateState: faker.helpers.arrayElement(states),
      mileage: faker.number.int({ min: 50000, max: 500000 }),
      status: faker.helpers.arrayElement(['active', 'maintenance', 'inactive']),
    };
  }

  generateHOS(driverId) {
    const statuses = ['ON_DUTY', 'OFF_DUTY', 'DRIVING', 'SLEEPER_BERTH'];
    const startTime = faker.date.recent({ days: 7 });
    const duration = faker.number.int({ min: 1, max: 11 }); // 1-11 hours
    const endTime = new Date(startTime.getTime() + duration * 3600000);
    
    return {
      driverId: driverId || faker.string.uuid(),
      status: faker.helpers.arrayElement(statuses),
      startTime: startTime.toISOString(),
      endTime: endTime.toISOString(),
      location: `${faker.location.city()}, ${faker.location.state({ abbreviated: true })}`,
      odometer: faker.number.int({ min: 100000, max: 500000 }),
      notes: `${TEST_DATA_PREFIX}${faker.lorem.sentence()}`,
      violations: [],
    };
  }

  async populateBackend(data) {
    console.log('\n📤 Populating backend with test data...\n');
    
    let created = {
      drivers: 0,
      vehicles: 0,
      hos: 0,
      errors: 0,
    };
    
    // Create drivers
    for (const driver of data.drivers) {
      try {
        const response = await axios.post(`${BASE_URL}/api/drivers`, driver);
        created.drivers++;
        this.generatedDriverIds.push(response.data.id);
        console.log(`✅ Created driver: ${driver.firstName} ${driver.lastName}`);
      } catch (error) {
        created.errors++;
        console.error(`❌ Failed to create driver: ${error.message}`);
      }
    }
    
    // Create vehicles
    for (const vehicle of data.vehicles) {
      try {
        const response = await axios.post(`${BASE_URL}/api/vehicles`, vehicle);
        created.vehicles++;
        this.generatedVehicleIds.push(response.data.id);
        console.log(`✅ Created vehicle: ${vehicle.unit}`);
      } catch (error) {
        created.errors++;
        console.error(`❌ Failed to create vehicle: ${error.message}`);
      }
    }
    
    // Create HOS records (use generated driver IDs if available)
    for (let i = 0; i < data.hos.length; i++) {
      const hos = data.hos[i];
      if (this.generatedDriverIds.length > 0) {
        hos.driverId = faker.helpers.arrayElement(this.generatedDriverIds);
      }
      
      try {
        await axios.post(`${BASE_URL}/api/hos`, hos);
        created.hos++;
        console.log(`✅ Created HOS record for driver ${hos.driverId}`);
      } catch (error) {
        created.errors++;
        console.error(`❌ Failed to create HOS record: ${error.message}`);
      }
    }
    
    console.log('\n' + '='.repeat(60));
    console.log('📊 POPULATION SUMMARY');
    console.log('='.repeat(60));
    console.log(`Drivers created: ${created.drivers}/${data.drivers.length}`);
    console.log(`Vehicles created: ${created.vehicles}/${data.vehicles.length}`);
    console.log(`HOS records created: ${created.hos}/${data.hos.length}`);
    console.log(`Errors: ${created.errors}`);
    console.log('='.repeat(60) + '\n');
  }

  generate(counts) {
    console.log('\n🎲 Generating test data with Faker...');
    console.log(`Drivers: ${counts.drivers}`);
    console.log(`Vehicles: ${counts.vehicles}`);
    console.log(`HOS records: ${counts.hos}\n`);
    
    const data = {
      drivers: [],
      vehicles: [],
      hos: [],
      metadata: {
        generatedAt: new Date().toISOString(),
        testDataPrefix: TEST_DATA_PREFIX,
        counts: counts,
      },
    };
    
    // Generate drivers
    for (let i = 0; i < counts.drivers; i++) {
      data.drivers.push(this.generateDriver());
    }
    
    // Generate vehicles
    for (let i = 0; i < counts.vehicles; i++) {
      data.vehicles.push(this.generateVehicle());
    }
    
    // Generate HOS records
    for (let i = 0; i < counts.hos; i++) {
      data.hos.push(this.generateHOS());
    }
    
    console.log('✅ Test data generated successfully!\n');
    
    return data;
  }
}

async function main() {
  const args = parseArgs();
  const generator = new TestDataGenerator();
  
  const data = generator.generate({
    drivers: args.drivers,
    vehicles: args.vehicles,
    hos: args.hos,
  });
  
  // Save to file if output specified
  if (args.output) {
    fs.writeFileSync(args.output, JSON.stringify(data, null, 2));
    console.log(`💾 Data saved to: ${args.output}\n`);
  }
  
  // Populate backend if requested
  if (args.populate) {
    await generator.populateBackend(data);
  } else {
    console.log('💡 Tip: Use --populate to create this data in the backend');
    console.log('💡 Tip: Use --output=filename.json to save to a file\n');
  }
}

main().catch((error) => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});
