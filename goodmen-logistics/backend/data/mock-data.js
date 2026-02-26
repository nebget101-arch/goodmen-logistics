// Deprecated mock data removed for deployment readiness.
module.exports = {};
/*
const { v4: uuidv4 } = require('uuid');

// Mock Drivers Data
const drivers = [
  {
    id: uuidv4(),
    firstName: 'John',
    lastName: 'Smith',
    email: 'john.smith@goodmenlogistics.com',
    phone: '555-0101',
    cdlNumber: 'CDL123456',
    cdlState: 'CA',
    cdlClass: 'A',
    endorsements: ['H', 'N', 'T'],
    cdlExpiry: '2026-12-15',
    medicalCertExpiry: '2025-08-20',
    hireDate: '2022-03-15',
    status: 'active',
    dqfCompleteness: 95,
    address: '123 Main St, Los Angeles, CA 90001',
    dateOfBirth: '1985-05-12',
    lastMVRCheck: '2025-01-15',
    clearinghouseStatus: 'eligible'
  },
  {
    id: uuidv4(),
    firstName: 'Sarah',
    lastName: 'Johnson',
    email: 'sarah.johnson@goodmenlogistics.com',
    phone: '555-0102',
    cdlNumber: 'CDL789012',
    cdlState: 'TX',
    cdlClass: 'A',
    endorsements: ['H', 'N'],
    cdlExpiry: '2027-03-22',
    medicalCertExpiry: '2025-02-10',
    hireDate: '2021-07-20',
    status: 'active',
    dqfCompleteness: 88,
    address: '456 Oak Ave, Houston, TX 77001',
    dateOfBirth: '1990-09-25',
    lastMVRCheck: '2025-01-10',
    clearinghouseStatus: 'eligible'
  },
  {
    id: uuidv4(),
    firstName: 'Michael',
    lastName: 'Davis',
    email: 'michael.davis@goodmenlogistics.com',
    phone: '555-0103',
    cdlNumber: 'CDL345678',
    cdlState: 'FL',
    cdlClass: 'B',
    endorsements: ['P', 'S'],
    cdlExpiry: '2025-06-30',
    medicalCertExpiry: '2024-12-15',
    hireDate: '2023-01-10',
    status: 'active',
    dqfCompleteness: 72,
    address: '789 Beach Blvd, Miami, FL 33101',
    dateOfBirth: '1988-11-03',
    lastMVRCheck: '2024-12-01',
    clearinghouseStatus: 'query-pending'
  }
];

// Mock Vehicles Data
const vehicles = [
  {
    id: uuidv4(),
    unitNumber: 'TRK-001',
    vin: '1HGBH41JXMN109186',
    make: 'Freightliner',
    model: 'Cascadia',
    year: 2022,
    licensePlate: 'CA-TRK001',
    state: 'CA',
    status: 'in-service',
    mileage: 125000,
    lastInspectionDate: '2025-01-15',
    nextPMDue: '2025-03-15',
    nextPMMileage: 135000,
    eldDeviceId: 'ELD-TRK001',
    insuranceExpiry: '2025-12-31',
    registrationExpiry: '2025-11-30'
  },
  {
    id: uuidv4(),
    unitNumber: 'TRK-002',
    vin: '2FMDK3KC5DBA12345',
    make: 'Kenworth',
    model: 'T680',
    year: 2021,
    licensePlate: 'TX-TRK002',
    state: 'TX',
    status: 'in-service',
    mileage: 98000,
    lastInspectionDate: '2025-01-20',
    nextPMDue: '2025-02-20',
    nextPMMileage: 108000,
    eldDeviceId: 'ELD-TRK002',
    insuranceExpiry: '2025-12-31',
    registrationExpiry: '2025-10-15'
  },
  {
    id: uuidv4(),
    unitNumber: 'TRK-003',
    vin: '3AKJHHDR1JSKG1234',
    make: 'Peterbilt',
    model: '579',
    year: 2020,
    licensePlate: 'FL-TRK003',
    state: 'FL',
    status: 'out-of-service',
    mileage: 245000,
    lastInspectionDate: '2025-01-25',
    nextPMDue: '2025-01-28',
    nextPMMileage: 250000,
    eldDeviceId: 'ELD-TRK003',
    insuranceExpiry: '2025-12-31',
    registrationExpiry: '2025-09-20',
    oosReason: 'Brake system repair required'
  }
];

// Mock HOS (Hours of Service) Data
const hosRecords = [
  {
    id: uuidv4(),
    driverId: drivers[0].id,
    driverName: `${drivers[0].firstName} ${drivers[0].lastName}`,
    date: '2025-02-04',
    onDutyHours: 10.5,
    drivingHours: 8.5,
    offDutyHours: 13.5,
    sleeperBerthHours: 0,
    violations: [],
    status: 'compliant',
    eldDeviceId: 'ELD-TRK001',
    logs: [
      { time: '06:00', status: 'on-duty-not-driving', location: 'Los Angeles, CA' },
      { time: '07:00', status: 'driving', location: 'Los Angeles, CA' },
      { time: '11:00', status: 'on-duty-not-driving', location: 'Bakersfield, CA' },
      { time: '11:30', status: 'off-duty', location: 'Bakersfield, CA' },
      { time: '12:00', status: 'driving', location: 'Bakersfield, CA' },
      { time: '16:30', status: 'off-duty', location: 'Sacramento, CA' }
    ]
  },
  {
    id: uuidv4(),
    driverId: drivers[1].id,
    driverName: `${drivers[1].firstName} ${drivers[1].lastName}`,
    date: '2025-02-04',
    onDutyHours: 11.5,
    drivingHours: 10.5,
    offDutyHours: 12.5,
    sleeperBerthHours: 0,
    violations: ['Approaching 11-hour drive limit'],
    status: 'warning',
    eldDeviceId: 'ELD-TRK002',
    logs: [
      { time: '05:00', status: 'on-duty-not-driving', location: 'Houston, TX' },
      { time: '06:00', status: 'driving', location: 'Houston, TX' },
      { time: '10:00', status: 'on-duty-not-driving', location: 'San Antonio, TX' },
      { time: '10:30', status: 'driving', location: 'San Antonio, TX' },
      { time: '16:30', status: 'off-duty', location: 'El Paso, TX' }
    ]
  },
  {
    id: uuidv4(),
    driverId: drivers[2].id,
    driverName: `${drivers[2].firstName} ${drivers[2].lastName}`,
    date: '2025-02-04',
    onDutyHours: 9.0,
    drivingHours: 7.5,
    offDutyHours: 15.0,
    sleeperBerthHours: 0,
    violations: [],
    status: 'compliant',
    eldDeviceId: 'ELD-TRK003',
    logs: [
      { time: '07:00', status: 'on-duty-not-driving', location: 'Miami, FL' },
      { time: '08:00', status: 'driving', location: 'Miami, FL' },
      { time: '12:00', status: 'off-duty', location: 'Orlando, FL' },
      { time: '13:00', status: 'driving', location: 'Orlando, FL' },
      { time: '15:30', status: 'off-duty', location: 'Jacksonville, FL' }
    ]
  }
];

// Mock Maintenance Records
const maintenanceRecords = [
  {
    id: uuidv4(),
    vehicleId: vehicles[0].id,
    vehicleUnit: vehicles[0].unitNumber,
    type: 'Preventive Maintenance',
    description: 'Oil change, filter replacement, safety inspection',
    datePerformed: '2025-01-15',
    mileage: 125000,
    mechanicName: 'Tom Wilson',
    cost: 450.00,
    status: 'completed',
    partsUsed: ['Oil Filter', 'Air Filter', 'Engine Oil (15W-40)'],
    nextServiceDue: '2025-03-15'
  },
  {
    id: uuidv4(),
    vehicleId: vehicles[1].id,
    vehicleUnit: vehicles[1].unitNumber,
    type: 'Repair',
    description: 'Brake pad replacement - front axle',
    datePerformed: '2025-01-20',
    mileage: 98000,
    mechanicName: 'Bob Martinez',
    cost: 680.00,
    status: 'completed',
    partsUsed: ['Brake Pads (Front Set)', 'Brake Rotors'],
    nextServiceDue: null
  },
  {
    id: uuidv4(),
    vehicleId: vehicles[2].id,
    vehicleUnit: vehicles[2].unitNumber,
    type: 'Repair',
    description: 'Brake system overhaul - safety critical',
    datePerformed: null,
    mileage: 245000,
    mechanicName: 'Assigned: Bob Martinez',
    cost: 0,
    status: 'pending',
    partsUsed: [],
    nextServiceDue: null,
    priority: 'critical'
  }
];

// Mock Drug & Alcohol Testing Records
const drugAlcoholRecords = [
  {
    id: uuidv4(),
    driverId: drivers[0].id,
    driverName: `${drivers[0].firstName} ${drivers[0].lastName}`,
    testType: 'Random',
    testDate: '2024-11-15',
    result: 'Negative',
    testingFacility: 'ABC Testing Center',
    collectorName: 'Jane Doe',
    specimen: 'Urine',
    substancesTested: ['Marijuana', 'Cocaine', 'Amphetamines', 'Opiates', 'PCP'],
    certifiedBy: 'MRO - Dr. Smith'
  },
  {
    id: uuidv4(),
    driverId: drivers[1].id,
    driverName: `${drivers[1].firstName} ${drivers[1].lastName}`,
    testType: 'Pre-Employment',
    testDate: '2021-07-10',
    result: 'Negative',
    testingFacility: 'XYZ Drug Testing',
    collectorName: 'John Anderson',
    specimen: 'Urine',
    substancesTested: ['Marijuana', 'Cocaine', 'Amphetamines', 'Opiates', 'PCP'],
    certifiedBy: 'MRO - Dr. Johnson'
  },
  {
    id: uuidv4(),
    driverId: drivers[0].id,
    driverName: `${drivers[0].firstName} ${drivers[0].lastName}`,
    testType: 'Random',
    testDate: '2025-01-20',
    result: 'Negative',
    testingFacility: 'ABC Testing Center',
    collectorName: 'Jane Doe',
    specimen: 'Urine',
    substancesTested: ['Marijuana', 'Cocaine', 'Amphetamines', 'Opiates', 'PCP'],
    certifiedBy: 'MRO - Dr. Smith'
  }
];

// Mock Loads/Dispatch Data
const loads = [
  {
    id: uuidv4(),
    loadNumber: 'LD-2025-001',
    driverId: drivers[0].id,
    driverName: `${drivers[0].firstName} ${drivers[0].lastName}`,
    vehicleId: vehicles[0].id,
    vehicleUnit: vehicles[0].unitNumber,
    status: 'in-transit',
    pickupLocation: 'Los Angeles, CA',
    deliveryLocation: 'Sacramento, CA',
    pickupDate: '2025-02-04T07:00:00',
    deliveryDate: '2025-02-04T17:00:00',
    commodity: 'Electronics',
    weight: 42000,
    distance: 385,
    rate: 1850.00,
    shipper: 'Tech Distribution Inc.',
    consignee: 'Northern Electronics',
    bolNumber: 'BOL-2025-001'
  },
  {
    id: uuidv4(),
    loadNumber: 'LD-2025-002',
    driverId: drivers[1].id,
    driverName: `${drivers[1].firstName} ${drivers[1].lastName}`,
    vehicleId: vehicles[1].id,
    vehicleUnit: vehicles[1].unitNumber,
    status: 'in-transit',
    pickupLocation: 'Houston, TX',
    deliveryLocation: 'El Paso, TX',
    pickupDate: '2025-02-04T06:00:00',
    deliveryDate: '2025-02-05T14:00:00',
    commodity: 'Food Products',
    weight: 38000,
    distance: 746,
    rate: 2450.00,
    shipper: 'Texas Food Distributors',
    consignee: 'West Texas Grocers',
    bolNumber: 'BOL-2025-002'
  },
  {
    id: uuidv4(),
    loadNumber: 'LD-2025-003',
    driverId: null,
    driverName: 'Unassigned',
    vehicleId: null,
    vehicleUnit: 'Unassigned',
    status: 'pending',
    pickupLocation: 'Atlanta, GA',
    deliveryLocation: 'Miami, FL',
    pickupDate: '2025-02-05T08:00:00',
    deliveryDate: '2025-02-06T16:00:00',
    commodity: 'Automotive Parts',
    weight: 35000,
    distance: 662,
    rate: 2100.00,
    shipper: 'AutoParts Warehouse',
    consignee: 'Florida Auto Supply',
    bolNumber: 'BOL-2025-003'
  }
];

// Mock Dashboard Stats
const dashboardStats = {
  activeDrivers: drivers.filter(d => d.status === 'active').length,
  totalDrivers: drivers.length,
  activeVehicles: vehicles.filter(v => v.status === 'in-service').length,
  totalVehicles: vehicles.length,
  activeLoads: loads.filter(l => l.status === 'in-transit').length,
  pendingLoads: loads.filter(l => l.status === 'pending').length,
  hosViolations: hosRecords.filter(h => h.violations.length > 0).length,
  dqfComplianceRate: Math.round(drivers.reduce((sum, d) => sum + d.dqfCompleteness, 0) / drivers.length),
  vehiclesNeedingMaintenance: vehicles.filter(v => 
    new Date(v.nextPMDue) <= new Date(Date.now() + 30*24*60*60*1000)
  ).length,
  expiredMedCerts: drivers.filter(d => 
    new Date(d.medicalCertExpiry) <= new Date()
  ).length,
  upcomingMedCerts: drivers.filter(d => {
    const expiry = new Date(d.medicalCertExpiry);
    const now = new Date();
    const thirtyDaysFromNow = new Date(Date.now() + 30*24*60*60*1000);
    return expiry > now && expiry <= thirtyDaysFromNow;
  }).length
};

module.exports = {
  drivers,
  vehicles,
  hosRecords,
  maintenanceRecords,
  drugAlcoholRecords,
  loads,
  dashboardStats
};

// Mock Locations Data
const locations = [
  {
    id: uuidv4(),
    name: 'Los Angeles Terminal',
    address: '123 Main St, Los Angeles, CA 90001',
    type: 'terminal',
    status: 'active',
    notes: 'Primary West Coast terminal.'
  },
  {
    id: uuidv4(),
    name: 'Houston Yard',
    address: '456 Oak Ave, Houston, TX 77001',
    type: 'yard',
    status: 'active',
    notes: 'Main Texas yard.'
  },
  {
    id: uuidv4(),
    name: 'Miami Drop Lot',
    address: '789 Beach Blvd, Miami, FL 33101',
    type: 'drop-lot',
    status: 'inactive',
    notes: 'Seasonal use only.'
  }
];

module.exports.locations = locations;
*/
