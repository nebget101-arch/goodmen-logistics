# Goodmen Logistics - Karate API Tests

Enterprise-level Karate API testing framework for the Goodmen Logistics FMCSA Compliance System.

## 📋 Table of Contents
- [Overview](#overview)
- [Framework Architecture](#framework-architecture)
- [Installation](#installation)
- [Running Tests](#running-tests)
- [Test Structure](#test-structure)
- [Feature Files](#feature-files)
- [Configuration](#configuration)
- [Best Practices](#best-practices)

## 🎯 Overview

This Karate testing framework provides comprehensive API automation for the Goodmen Logistics backend, covering all FMCSA compliance endpoints:
- Dashboard Statistics & Alerts
- Driver Qualification Files (DQF) Management
- Vehicle Fleet Management
- Hours of Service (HOS) Records
- Vehicle Maintenance Tracking
- Load Dispatch System
- Drug & Alcohol Testing Program
- Audit Trail & Compliance Reports

## 🏗️ Framework Architecture

```
karate-tests/
├── src/
│   └── test/
│       └── java/
│           ├── com/goodmen/logistics/
│           │   ├── TestRunner.java              # Main test runner
│           │   └── features/                    # Feature files
│           │       ├── dashboard.feature
│           │       ├── drivers.feature
│           │       ├── vehicles.feature
│           │       ├── hos.feature
│           │       ├── maintenance.feature
│           │       ├── loads.feature
│           │       ├── drug-alcohol.feature
│           │       └── audit.feature
│           ├── test-data/                       # Test data files
│           │   ├── driver-valid.json
│           │   └── vehicle-valid.json
│           └── karate-config.js                 # Global configuration
├── pom.xml                                      # Maven dependencies
└── README.md                                    # This file
```

## 🚀 Installation

### Prerequisites
- Java JDK 11 or higher
- Maven 3.6+
- Node.js (backend server must be running)

### Install Dependencies

```bash
cd karate-tests
mvn clean install -DskipTests
```

## ▶️ Running Tests

### Run All Tests
```bash
mvn test
```

### Run Tests in Parallel (5 threads)
```bash
mvn test -Dtest=TestRunner#testParallel
```

### Run Smoke Tests Only
```bash
mvn test -Dtest=TestRunner#testSmoke
```

### Run Regression Tests
```bash
mvn test -Dtest=TestRunner#testRegression
```

### Run Specific Feature
```bash
mvn test -Dkarate.options="classpath:com/goodmen/logistics/features/drivers.feature"
```

### Run with Specific Environment
```bash
mvn test -Dkarate.env=qa
mvn test -Dkarate.env=staging
mvn test -Dkarate.env=prod
```

### Run with Tags
```bash
# Run only smoke tests
mvn test -Dkarate.options="--tags @smoke"

# Run FMCSA compliance tests
mvn test -Dkarate.options="--tags @fmcsa"

# Run positive tests only
mvn test -Dkarate.options="--tags @positive"

# Exclude ignored tests
mvn test -Dkarate.options="--tags ~@ignore"
```

## 📁 Test Structure

### Feature File Structure

```gherkin
@smoke @regression @module
Feature: Module Name - Description

  Background:
    * url baseUrl
    * configure headers = headers

  @positive
  Scenario: Test scenario name
    Given path 'endpoint'
    When method GET
    Then status 200
    And match response == '#array'
```

### Test Organization

**Test Tags:**
- `@smoke` - Critical smoke tests
- `@regression` - Full regression suite
- `@positive` - Happy path scenarios
- `@negative` - Error handling tests
- `@performance` - Response time validation
- `@fmcsa` - FMCSA compliance tests
- `@compliance` - General compliance validation
- `@retention` - Record retention verification
- `@dataValidation` - Data integrity checks

## 📄 Feature Files

### Dashboard API (`dashboard.feature`)
Tests for dashboard statistics and alerts:
- GET `/dashboard/stats` - Dashboard statistics
- GET `/dashboard/alerts` - System alerts
- GET `/health` - Health check

### Drivers API (`drivers.feature`)
Tests for Driver Qualification Files:
- GET `/drivers` - List all drivers
- GET `/drivers/{id}` - Get driver by ID
- POST `/drivers` - Create new driver
- PUT `/drivers/{id}` - Update driver
- DELETE `/drivers/{id}` - Delete driver
- GET `/drivers/compliance-issues` - Compliance violations

**FMCSA Compliance:**
- CDL format validation
- Medical certificate expiration
- DQF retention (3 years after driver leaves)

### Vehicles API (`vehicles.feature`)
Tests for fleet management:
- GET `/vehicles` - List all vehicles
- GET `/vehicles/{id}` - Get vehicle by ID
- POST `/vehicles` - Create new vehicle
- PUT `/vehicles/{id}` - Update vehicle
- DELETE `/vehicles/{id}` - Delete vehicle
- GET `/vehicles/maintenance-alerts` - Maintenance alerts

**FMCSA Compliance:**
- VIN format validation (17 characters)
- Inspection schedules
- Maintenance record retention (1 year + 6 months)

### HOS API (`hos.feature`)
Tests for Hours of Service:
- GET `/hos` - HOS records
- GET `/hos/violations` - HOS violations

**FMCSA Compliance (49 CFR Part 395):**
- 11-hour driving limit
- 14-hour on-duty limit
- HOS record retention (6 months)

### Maintenance API (`maintenance.feature`)
Tests for vehicle maintenance:
- GET `/maintenance` - Maintenance records
- GET `/maintenance/schedule` - Maintenance schedule
- GET `/maintenance/vehicle/{id}` - Vehicle-specific records

### Loads API (`loads.feature`)
Tests for load dispatch:
- GET `/loads` - Load list
- GET `/loads/{id}` - Load details
- Active load tracking

### Drug & Alcohol API (`drug-alcohol.feature`)
Tests for drug and alcohol testing program:
- GET `/drug-alcohol` - Test records
- GET `/drug-alcohol/program-status` - Program status

**FMCSA Compliance (49 CFR Part 382):**
- Test type validation
- Record retention (5 years)

### Audit API (`audit.feature`)
Tests for audit trail and compliance:
- GET `/audit/trail` - Audit trail
- GET `/audit/compliance-report` - Compliance report
- GET `/audit/export` - Export audit data

## 🛠️ Configuration

### Environment Configuration (`karate-config.js`)

The framework supports multiple environments:

```javascript
// Default: dev
var config = {
  baseUrl: 'http://localhost:3000/api'
};

// Override for other environments
if (env == 'qa') {
  config.baseUrl = 'http://qa.goodmenlogistics.com/api';
}
```

### Global Functions

```javascript
// Generate random string
config.generateRandomString(10)

// Generate random number
config.generateRandomNumber(1, 100)

// Get current date
config.getCurrentDate()

// Get future date
config.getFutureDate(30)  // 30 days ahead
```

## 📊 Test Data

Test data is stored in JSON files under `test-data/`:

```gherkin
Feature: Drivers API

  Background:
    * def testDriver = read('classpath:test-data/driver-valid.json')

  Scenario: Create new driver
    Given path 'drivers'
    And request testDriver
    When method POST
    Then status 201
```

## ✅ Karate Features Used

### JSON Matching
```gherkin
# Exact match
And match response == { id: 1, name: 'John' }

# Schema match
And match response == { id: '#number', name: '#string' }

# Array match
And match response == '#array'
And match each response == { id: '#number' }

# Conditional match
And match response.count == '#? _ > 0'
```

### Response Validation
```gherkin
Then status 200
And assert responseTime < 2000
And match header Content-Type contains 'application/json'
```

### Data Extraction
```gherkin
* def driverId = response[0].id
* def drivers = karate.filter(response, function(x){ return x.status == 'Active' })
```

### Loops and Conditional Logic
```gherkin
* def drivers = karate.map(response, function(x){ return x.id })
* def activeDrivers = karate.filter(response, function(x){ return x.status == 'Active' })
```

## 📈 Reporting

### HTML Reports
After test execution, HTML reports are generated:

```
target/karate-reports/karate-summary.html
```

Open this file in a browser to view detailed results.

### Console Output
```bash
mvn test

# Output shows:
- Feature execution status
- Scenario pass/fail
- Response times
- Error details
```

## 🔍 Test Categories

### By Module
- Dashboard (`@dashboard`)
- Drivers (`@drivers`)
- Vehicles (`@vehicles`)
- HOS (`@hos`)
- Maintenance (`@maintenance`)
- Loads (`@loads`)
- Drug & Alcohol (`@drugalcohol`)
- Audit (`@audit`)

### By Test Type
- Smoke (`@smoke`)
- Regression (`@regression`)
- Positive (`@positive`)
- Negative (`@negative`)
- Performance (`@performance`)
- Data Validation (`@dataValidation`)

### By Compliance
- FMCSA (`@fmcsa`)
- Compliance (`@compliance`)
- Retention (`@retention`)

## 🐛 Debugging

### Enable Debug Logging
```bash
mvn test -Dkarate.options="--tags @debug" -Dkarate.logger.level=DEBUG
```

### Print Variables
```gherkin
* print 'Driver ID:', driverId
* print 'Response:', response
```

### Karate Debug Mode
```gherkin
* configure driver = { type: 'chrome', showDriverLog: true }
```

## ✨ Best Practices

### 1. Use Background for Common Setup
```gherkin
Background:
  * url baseUrl
  * configure headers = headers
  * def testData = read('test-data.json')
```

### 2. Reuse Scenarios
```gherkin
* def result = call read('common-scenario.feature')
```

### 3. Extract Reusable Functions
```javascript
// karate-config.js
config.createDriver = function() {
  return {
    name: 'Test Driver',
    cdlNumber: 'CA-' + Math.random()
  };
};
```

### 4. Use Schema Matching
```gherkin
And match each response == 
  """
  {
    id: '#number',
    name: '#string',
    status: '#string'
  }
  """
```

### 5. Verify FMCSA Compliance
```gherkin
@fmcsa @retention
Scenario: Verify retention requirements
  * print 'DQF retention: 3 years (49 CFR 391.51)'
```

## 📝 Writing New Tests

### Step 1: Create Feature File
```gherkin
@smoke @newmodule
Feature: New Module API

  Background:
    * url baseUrl
    * configure headers = headers

  @positive
  Scenario: Get data
    Given path 'new-endpoint'
    When method GET
    Then status 200
```

### Step 2: Add Test Data
```json
// test-data/new-data.json
{
  "field": "value"
}
```

### Step 3: Run Tests
```bash
mvn test -Dkarate.options="--tags @newmodule"
```

## 🔧 Troubleshooting

### Backend Not Running
```
Error: Connection refused
Solution: Start backend server (npm start in backend folder)
```

### Tests Timing Out
```gherkin
# Increase timeout
* configure connectTimeout = 30000
* configure readTimeout = 30000
```

### JSON Match Failure
```gherkin
# Use fuzzy matching
And match response contains { id: '#number' }

# Or print response
* print response
```

## 🤝 Contributing

1. Follow Gherkin best practices
2. Add appropriate tags to scenarios
3. Include FMCSA compliance verification
4. Add test data to `test-data/` folder
5. Update documentation

## 📞 Support

For questions or issues:
- Review Karate reports in `target/karate-reports/`
- Check console output for detailed errors
- Karate documentation: https://github.com/karatelabs/karate

---

**Version**: 1.0.0  
**Last Updated**: February 2026  
**Framework**: Karate 1.4+  
**Build Tool**: Maven 3.6+
