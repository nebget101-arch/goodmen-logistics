/**
 * Cleanup Test Data
 * 
 * Removes test data created during performance tests from the backend.
 * Identifies test data by the TEST_DATA_ prefix.
 * 
 * Usage:
 *   node scripts/cleanup-test-data.js
 *   node scripts/cleanup-test-data.js --dry-run
 *   node scripts/cleanup-test-data.js --older-than=24h
 */

const axios = require('axios');

// Configuration
const BASE_URL = process.env.BASE_URL || 'https://safetyapp-ln58.onrender.com';
const TEST_DATA_PREFIX = 'TEST_DATA_';
const DRY_RUN = process.argv.includes('--dry-run');

// Parse --older-than argument (e.g., --older-than=24h)
function parseOlderThan() {
  const arg = process.argv.find(a => a.startsWith('--older-than='));
  if (!arg) return 0;
  
  const value = arg.split('=')[1];
  const match = value.match(/^(\d+)(h|m|d)$/);
  if (!match) return 0;
  
  const [, num, unit] = match;
  const multipliers = { m: 60000, h: 3600000, d: 86400000 };
  return parseInt(num) * multipliers[unit];
}

const OLDER_THAN_MS = parseOlderThan();

class TestDataCleanup {
  constructor() {
    this.stats = {
      drivers: { found: 0, deleted: 0, errors: 0 },
      vehicles: { found: 0, deleted: 0, errors: 0 },
      hos: { found: 0, deleted: 0, errors: 0 },
    };
  }

  log(message, type = 'info') {
    const prefix = {
      info: 'ℹ️ ',
      success: '✅',
      error: '❌',
      warning: '⚠️ ',
    };
    console.log(`${prefix[type]} ${message}`);
  }

  async cleanupDrivers() {
    this.log('Cleaning up test drivers...', 'info');
    
    try {
      // Fetch all drivers
      const response = await axios.get(`${BASE_URL}/api/drivers`);
      const drivers = response.data;
      
      for (const driver of drivers) {
        // Check if it's test data
        const isTestData = 
          driver.firstName?.startsWith(TEST_DATA_PREFIX) ||
          driver.email?.toLowerCase().includes(TEST_DATA_PREFIX.toLowerCase()) ||
          driver.cdlNumber?.startsWith(TEST_DATA_PREFIX);
        
        if (!isTestData) continue;
        
        this.stats.drivers.found++;
        
        // Check age if OLDER_THAN_MS is set
        if (OLDER_THAN_MS > 0 && driver.createdAt) {
          const age = Date.now() - new Date(driver.createdAt).getTime();
          if (age < OLDER_THAN_MS) {
            this.log(`Skipping driver ${driver.id} (too recent)`, 'warning');
            continue;
          }
        }
        
        if (DRY_RUN) {
          this.log(`[DRY RUN] Would delete driver: ${driver.firstName} ${driver.lastName} (ID: ${driver.id})`, 'warning');
        } else {
          try {
            await axios.delete(`${BASE_URL}/api/drivers/${driver.id}`);
            this.stats.drivers.deleted++;
            this.log(`Deleted driver: ${driver.firstName} ${driver.lastName} (ID: ${driver.id})`, 'success');
          } catch (error) {
            this.stats.drivers.errors++;
            this.log(`Failed to delete driver ${driver.id}: ${error.message}`, 'error');
          }
        }
      }
    } catch (error) {
      this.log(`Error fetching drivers: ${error.message}`, 'error');
    }
  }

  async cleanupVehicles() {
    this.log('Cleaning up test vehicles...', 'info');
    
    try {
      const response = await axios.get(`${BASE_URL}/api/vehicles`);
      const vehicles = response.data;
      
      for (const vehicle of vehicles) {
        const isTestData = 
          vehicle.unit?.startsWith(TEST_DATA_PREFIX) ||
          vehicle.vin?.startsWith(TEST_DATA_PREFIX) ||
          vehicle.licensePlate?.startsWith(TEST_DATA_PREFIX);
        
        if (!isTestData) continue;
        
        this.stats.vehicles.found++;
        
        if (OLDER_THAN_MS > 0 && vehicle.createdAt) {
          const age = Date.now() - new Date(vehicle.createdAt).getTime();
          if (age < OLDER_THAN_MS) continue;
        }
        
        if (DRY_RUN) {
          this.log(`[DRY RUN] Would delete vehicle: ${vehicle.unit} (ID: ${vehicle.id})`, 'warning');
        } else {
          try {
            await axios.delete(`${BASE_URL}/api/vehicles/${vehicle.id}`);
            this.stats.vehicles.deleted++;
            this.log(`Deleted vehicle: ${vehicle.unit} (ID: ${vehicle.id})`, 'success');
          } catch (error) {
            this.stats.vehicles.errors++;
            this.log(`Failed to delete vehicle ${vehicle.id}: ${error.message}`, 'error');
          }
        }
      }
    } catch (error) {
      this.log(`Error fetching vehicles: ${error.message}`, 'error');
    }
  }

  async cleanupHOS() {
    this.log('Cleaning up test HOS records...', 'info');
    
    try {
      const response = await axios.get(`${BASE_URL}/api/hos`);
      const hosRecords = response.data;
      
      for (const record of hosRecords) {
        const isTestData = record.notes?.includes(TEST_DATA_PREFIX);
        
        if (!isTestData) continue;
        
        this.stats.hos.found++;
        
        if (OLDER_THAN_MS > 0 && record.createdAt) {
          const age = Date.now() - new Date(record.createdAt).getTime();
          if (age < OLDER_THAN_MS) continue;
        }
        
        if (DRY_RUN) {
          this.log(`[DRY RUN] Would delete HOS record: ${record.id}`, 'warning');
        } else {
          try {
            await axios.delete(`${BASE_URL}/api/hos/${record.id}`);
            this.stats.hos.deleted++;
            this.log(`Deleted HOS record: ${record.id}`, 'success');
          } catch (error) {
            this.stats.hos.errors++;
            this.log(`Failed to delete HOS record ${record.id}: ${error.message}`, 'error');
          }
        }
      }
    } catch (error) {
      this.log(`Error fetching HOS records: ${error.message}`, 'error');
    }
  }

  printSummary() {
    console.log('\n' + '='.repeat(60));
    console.log('📊 CLEANUP SUMMARY');
    console.log('='.repeat(60));
    
    if (DRY_RUN) {
      console.log('⚠️  DRY RUN MODE - No data was actually deleted\n');
    }
    
    console.log('Drivers:');
    console.log(`  Found: ${this.stats.drivers.found}`);
    console.log(`  Deleted: ${this.stats.drivers.deleted}`);
    console.log(`  Errors: ${this.stats.drivers.errors}`);
    
    console.log('\nVehicles:');
    console.log(`  Found: ${this.stats.vehicles.found}`);
    console.log(`  Deleted: ${this.stats.vehicles.deleted}`);
    console.log(`  Errors: ${this.stats.vehicles.errors}`);
    
    console.log('\nHOS Records:');
    console.log(`  Found: ${this.stats.hos.found}`);
    console.log(`  Deleted: ${this.stats.hos.deleted}`);
    console.log(`  Errors: ${this.stats.hos.errors}`);
    
    const totalFound = this.stats.drivers.found + this.stats.vehicles.found + this.stats.hos.found;
    const totalDeleted = this.stats.drivers.deleted + this.stats.vehicles.deleted + this.stats.hos.deleted;
    const totalErrors = this.stats.drivers.errors + this.stats.vehicles.errors + this.stats.hos.errors;
    
    console.log('\n' + '-'.repeat(60));
    console.log(`Total Found: ${totalFound}`);
    console.log(`Total Deleted: ${totalDeleted}`);
    console.log(`Total Errors: ${totalErrors}`);
    console.log('='.repeat(60) + '\n');
    
    if (DRY_RUN) {
      console.log('💡 Tip: Run without --dry-run to actually delete the data');
    }
  }

  async run() {
    console.log('\n🧹 Test Data Cleanup Tool');
    console.log(`Base URL: ${BASE_URL}`);
    console.log(`Test Data Prefix: ${TEST_DATA_PREFIX}`);
    
    if (DRY_RUN) {
      console.log('⚠️  DRY RUN MODE - No data will be deleted\n');
    }
    
    if (OLDER_THAN_MS > 0) {
      const hours = Math.floor(OLDER_THAN_MS / 3600000);
      console.log(`Only deleting data older than ${hours} hours\n`);
    }
    
    console.log('Starting cleanup...\n');
    
    await this.cleanupDrivers();
    await this.cleanupVehicles();
    await this.cleanupHOS();
    
    this.printSummary();
  }
}

// Run cleanup
async function main() {
  const cleanup = new TestDataCleanup();
  await cleanup.run();
}

main().catch((error) => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});
