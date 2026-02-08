# Goodmen Logistics - Cypress UI Tests

Enterprise-level Cypress testing framework for the Goodmen Logistics FMCSA Compliance System.

## 📋 Table of Contents
- [Overview](#overview)
- [Framework Architecture](#framework-architecture)
- [Installation](#installation)
- [Running Tests](#running-tests)
- [Test Structure](#test-structure)
- [Page Object Model](#page-object-model)
- [Custom Commands](#custom-commands)
- [Best Practices](#best-practices)

## 🎯 Overview

This Cypress testing framework provides comprehensive UI automation for the Goodmen Logistics application, covering all FMCSA compliance modules:
- Dashboard
- Driver Qualification Files (DQF)
- Vehicle Fleet Management
- Hours of Service (HOS)
- Vehicle Maintenance
- Load Dispatch
- Audit & Compliance Reports

## 🏗️ Framework Architecture

```
cypress-tests/
├── cypress/
│   ├── e2e/                          # Test specifications
│   │   ├── smoke/                    # Smoke tests
│   │   ├── dashboard/                # Dashboard module tests
│   │   ├── drivers/                  # Drivers module tests
│   │   ├── vehicles/                 # Vehicles module tests
│   │   ├── hos/                      # HOS module tests
│   │   ├── maintenance/              # Maintenance tests
│   │   ├── loads/                    # Load dispatch tests
│   │   └── audit/                    # Audit tests
│   ├── fixtures/                     # Test data
│   │   ├── drivers.json
│   │   └── vehicles.json
│   ├── support/
│   │   ├── page-objects/             # Page Object Model
│   │   │   ├── BasePage.js
│   │   │   ├── DashboardPage.js
│   │   │   ├── DriversPage.js
│   │   │   └── VehiclesPage.js
│   │   ├── commands.js               # Custom Cypress commands
│   │   └── e2e.js                    # Global configuration
│   ├── screenshots/                  # Test failure screenshots
│   └── videos/                       # Test execution videos
├── cypress.config.js                 # Cypress configuration
└── package.json                      # Dependencies
```

## 🚀 Installation

### Prerequisites
- Node.js v18 or higher
- npm or yarn

### Install Dependencies

```bash
cd cypress-tests
npm install
```

## ▶️ Running Tests

### Open Cypress Test Runner (Interactive Mode)
```bash
npm run cy:open
```

### Run All Tests (Headless)
```bash
npm test
# or
npm run cy:run
```

### Run Tests by Browser
```bash
npm run cy:run:chrome
npm run cy:run:firefox
npm run cy:run:edge
```

### Run Specific Module Tests
```bash
npm run cy:run:dashboard
npm run cy:run:drivers
npm run cy:run:vehicles
npm run cy:run:hos
npm run cy:run:maintenance
npm run cy:run:loads
npm run cy:run:audit
```

### Run Smoke Tests Only
```bash
npm run cy:run:smoke
```

### Run in Headed Mode (See Browser)
```bash
npm run cy:run:headed
```

## 📁 Test Structure

### Test Organization

Tests are organized by module and test type:

**Smoke Tests** (`cypress/e2e/smoke/`)
- Quick validation tests
- Run before full regression
- Cover critical user paths

**Module Tests** (`cypress/e2e/<module>/`)
- Comprehensive functional tests
- FMCSA compliance validation
- Data integrity checks
- API integration tests

### Test Naming Convention

```javascript
describe('Module Name - Test Suite', () => {
  context('Feature Context', () => {
    it('should do something specific', () => {
      // Test implementation
    });
  });
});
```

## 📄 Page Object Model

### Base Page
All page objects extend `BasePage`, which provides common methods:

```javascript
import BasePage from './BasePage';

class DashboardPage extends BasePage {
  constructor() {
    super();
    this.url = '/';
  }

  visit() {
    super.visit(this.url);
    return this;
  }

  verifyDashboardLoaded() {
    this.verifyPageHeader(/Dashboard/i);
    return this;
  }
}
```

### Available Page Objects
- `BasePage` - Common functionality
- `DashboardPage` - Dashboard operations
- `DriversPage` - Driver management
- `VehiclesPage` - Fleet management

## 🛠️ Custom Commands

### Navigation Commands

```javascript
// Navigate to specific module
cy.navigateTo('drivers');
cy.navigateTo('vehicles');
```

### API Commands

```javascript
// Make API requests
cy.apiRequest('GET', '/drivers');
cy.apiRequest('POST', '/drivers', driverData);

// Intercept and wait for API
cy.interceptApi('GET', '/drivers', 'getDrivers');
cy.waitForApi('getDrivers');
```

### Verification Commands

```javascript
// Verify table has data
cy.verifyTableHasData('table');

// Verify page title
cy.verifyPageTitle('Drivers');

// Verify navigation
cy.verifyNavigation();

// Verify loading complete
cy.verifyLoadingComplete();
```

### Interaction Commands

```javascript
// Click button by text
cy.clickButton('Add Driver');

// Fill form field
cy.fillField('Name', 'John Doe');

// Verify alert
cy.verifyAlert('Success');
```

## 📊 Test Fixtures

Test data is stored in JSON fixtures:

```javascript
// Load fixture in test
cy.fixture('drivers').then((drivers) => {
  const testDriver = drivers.validDriver;
  // Use test data
});
```

## 📸 Screenshots and Videos

- **Screenshots**: Automatically captured on test failure
- **Videos**: Recorded for all test runs
- Location: `cypress/screenshots/` and `cypress/videos/`

## ✅ Best Practices

### 1. Use Page Objects
```javascript
// Good
const driversPage = new DriversPage();
driversPage.visit().verifyDriversPageLoaded();

// Avoid
cy.visit('/drivers');
cy.contains('Drivers').should('be.visible');
```

### 2. Use Custom Commands
```javascript
// Good
cy.navigateTo('drivers');

// Avoid
cy.visit('/drivers');
cy.wait(500);
```

### 3. Wait for API Responses
```javascript
cy.interceptApi('GET', '/drivers', 'getDrivers');
cy.visit('/drivers');
cy.waitForApi('getDrivers');
```

### 4. Use Fixtures for Test Data
```javascript
cy.fixture('drivers').then((drivers) => {
  cy.apiRequest('POST', '/drivers', drivers.validDriver);
});
```

### 5. Chain Page Object Methods
```javascript
driversPage
  .visit()
  .verifyDriversPageLoaded()
  .searchDriver('John')
  .verifyDriverExists('John');
```

## 🔍 Test Categories

### By Priority
- `@smoke` - Critical path tests
- `@regression` - Full regression suite

### By Type
- `@positive` - Happy path scenarios
- `@negative` - Error handling
- `@performance` - Response time checks
- `@dataValidation` - Data integrity

### By Compliance
- `@fmcsa` - FMCSA compliance tests
- `@compliance` - General compliance
- `@retention` - Record retention

## 🐛 Debugging

### View Test Results
1. Check console output
2. Review screenshots in `cypress/screenshots/`
3. Watch videos in `cypress/videos/`
4. Use Cypress Test Runner for interactive debugging

### Common Issues

**Tests Timing Out**
```javascript
// Increase timeout
cy.get('.element', { timeout: 10000 });
```

**Element Not Found**
```javascript
// Wait for element
cy.get('.element').should('exist');
```

**API Not Responding**
```javascript
// Verify backend is running
// Check baseUrl in cypress.config.js
```

## 📈 Reporting

Tests use Mochawesome for reporting (optional):

```bash
npm run test:report
```

Reports are generated in `cypress/reports/`

## 🔧 Configuration

Edit `cypress.config.js` to modify:
- Base URL
- API URL
- Timeouts
- Viewport size
- Video/screenshot settings

```javascript
{
  e2e: {
    baseUrl: 'http://localhost:4200',
    apiUrl: 'http://localhost:3000/api',
    defaultCommandTimeout: 10000,
  }
}
```

## 📝 Writing New Tests

### Step 1: Create Page Object (if needed)
```javascript
// cypress/support/page-objects/NewPage.js
import BasePage from './BasePage';

class NewPage extends BasePage {
  visit() {
    super.visit('/new-page');
    return this;
  }
}

export default NewPage;
```

### Step 2: Create Test Spec
```javascript
// cypress/e2e/new-module/new-feature.cy.js
import NewPage from '../../support/page-objects/NewPage';

describe('New Feature Tests', () => {
  const newPage = new NewPage();

  beforeEach(() => {
    newPage.visit();
  });

  it('should verify new feature', () => {
    // Test implementation
  });
});
```

### Step 3: Add Test Data (if needed)
```javascript
// cypress/fixtures/new-data.json
{
  "validData": {
    "field": "value"
  }
}
```

## 🤝 Contributing

1. Follow Page Object Model pattern
2. Use custom commands for reusable actions
3. Add appropriate test tags
4. Include FMCSA compliance verification
5. Update documentation for new features

## 📞 Support

For questions or issues:
- Review test logs and screenshots
- Check Cypress documentation: https://docs.cypress.io
- Review Page Object implementations

---

**Version**: 1.0.0  
**Last Updated**: February 2026  
**Framework**: Cypress 13.6+
