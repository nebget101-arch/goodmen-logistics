# Goodmen Logistics - Testing Overview

Enterprise testing strategy for the Goodmen Logistics FMCSA Compliance System.

## 📋 Table of Contents
- [Overview](#overview)
- [Testing Strategy](#testing-strategy)
- [Test Frameworks](#test-frameworks)
- [Quick Start](#quick-start)
- [Prerequisites](#prerequisites)
- [Test Execution](#test-execution)
- [CI/CD Integration](#cicd-integration)

## 🎯 Overview

The Goodmen Logistics testing suite includes:
- **Cypress** - UI/E2E testing
- **Karate** - API testing

Both frameworks follow enterprise patterns with comprehensive coverage of FMCSA compliance requirements.

## 🏗️ Testing Strategy

### Test Pyramid

```
           /\
          /  \
         / UI \          Cypress E2E Tests
        /------\
       /  API   \        Karate API Tests
      /----------\
     / Unit Tests \      (Application-level)
    /--------------\
```

### Test Coverage

| Module | UI Tests | API Tests | FMCSA Compliance |
|--------|----------|-----------|------------------|
| Dashboard | ✅ | ✅ | ✅ |
| Drivers (DQF) | ✅ | ✅ | ✅ 49 CFR 391 |
| Vehicles | ✅ | ✅ | ✅ 49 CFR 396 |
| HOS | ✅ | ✅ | ✅ 49 CFR 395 |
| Maintenance | ✅ | ✅ | ✅ 49 CFR 396 |
| Loads | ✅ | ✅ | - |
| Drug/Alcohol | - | ✅ | ✅ 49 CFR 382 |
| Audit | ✅ | ✅ | ✅ |

## 🧪 Test Frameworks

### Cypress (UI Testing)

**Location:** `cypress-tests/`

**Features:**
- Page Object Model
- Custom commands
- Automatic screenshots/videos
- Interactive test runner
- Real browser testing

**Test Types:**
- Smoke tests
- Functional tests
- Integration tests
- Visual regression

**Documentation:** [Cypress README](cypress-tests/README.md)

### Karate (API Testing)

**Location:** `karate-tests/`

**Features:**
- Gherkin syntax
- Built-in assertions
- JSON/XML matching
- Parallel execution
- Environment configuration

**Test Types:**
- Smoke tests
- Functional tests
- Performance tests
- Data validation
- Compliance verification

**Documentation:** [Karate README](karate-tests/README.md)

## 🚀 Quick Start

### 1. Start the Application

**Backend:**
```bash
cd goodmen-logistics/backend
npm install
node server.js
```

**Frontend:**
```bash
cd goodmen-logistics/frontend
npm install
npm start
```

### 2. Run Cypress Tests

```bash
cd cypress-tests
npm install
npm run cy:open    # Interactive mode
npm test           # Headless mode
```

### 3. Run Karate Tests

```bash
cd karate-tests
mvn clean install -DskipTests
mvn test
```

## 📋 Prerequisites

### System Requirements

**For Cypress:**
- Node.js v18+
- npm or yarn
- Modern browser (Chrome, Firefox, Edge)

**For Karate:**
- Java JDK 11+
- Maven 3.6+

**For Application:**
- Node.js v18+
- Running backend (port 3000)
- Running frontend (port 4200)

### Installation

```bash
# Cypress
cd cypress-tests
npm install

# Karate
cd karate-tests
mvn clean install -DskipTests
```

## ▶️ Test Execution

### Smoke Tests (Quick Validation)

```bash
# Cypress smoke tests (~2 minutes)
cd cypress-tests
npm run cy:run:smoke

# Karate smoke tests (~1 minute)
cd karate-tests
mvn test -Dtest=TestRunner#testSmoke
```

### Full Regression Suite

```bash
# Cypress full suite (~10-15 minutes)
cd cypress-tests
npm test

# Karate full suite (~5 minutes)
cd karate-tests
mvn test -Dtest=TestRunner#testRegression
```

### Module-Specific Tests

```bash
# Cypress - specific module
npm run cy:run:drivers
npm run cy:run:vehicles
npm run cy:run:hos

# Karate - specific feature
mvn test -Dkarate.options="classpath:com/goodmen/logistics/features/drivers.feature"
```

### Parallel Execution

```bash
# Karate parallel (5 threads)
cd karate-tests
mvn test -Dtest=TestRunner#testParallel
```

## 📊 Test Reports

### Cypress Reports

**Location:** `cypress-tests/cypress/`
- Screenshots: `screenshots/`
- Videos: `videos/`
- Console output during execution

**View Results:**
```bash
open cypress/videos/
open cypress/screenshots/
```

### Karate Reports

**Location:** `karate-tests/target/karate-reports/`

**View Results:**
```bash
open target/karate-reports/karate-summary.html
```

## 🏷️ Test Tags

### Cypress

```javascript
// Run by spec
npm run cy:run:dashboard
npm run cy:run:drivers

// Run by folder
cypress run --spec "cypress/e2e/smoke/**"
```

### Karate

```bash
# Run by tag
mvn test -Dkarate.options="--tags @smoke"
mvn test -Dkarate.options="--tags @fmcsa"
mvn test -Dkarate.options="--tags @positive"

# Exclude tags
mvn test -Dkarate.options="--tags ~@ignore"
```

## 🔄 CI/CD Integration

### GitHub Actions Example

```yaml
name: Test Suite

on: [push, pull_request]

jobs:
  api-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-java@v3
        with:
          java-version: '11'
      - name: Run Karate Tests
        run: |
          cd karate-tests
          mvn test

  ui-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      - name: Start Application
        run: |
          cd goodmen-logistics/backend && npm install && node server.js &
          cd goodmen-logistics/frontend && npm install && npm start &
      - name: Run Cypress Tests
        run: |
          cd cypress-tests
          npm install
          npm test
```

### Jenkins Pipeline Example

```groovy
pipeline {
    agent any
    
    stages {
        stage('API Tests') {
            steps {
                dir('karate-tests') {
                    sh 'mvn clean test'
                }
            }
        }
        
        stage('UI Tests') {
            steps {
                dir('cypress-tests') {
                    sh 'npm install'
                    sh 'npm test'
                }
            }
        }
    }
    
    post {
        always {
            publishHTML([
                reportDir: 'karate-tests/target/karate-reports',
                reportFiles: 'karate-summary.html',
                reportName: 'Karate API Test Report'
            ])
            publishHTML([
                reportDir: 'cypress-tests/cypress/reports',
                reportFiles: 'index.html',
                reportName: 'Cypress UI Test Report'
            ])
        }
    }
}
```

## 🎯 Test Scenarios

### Critical User Journeys (Smoke Tests)

1. **Dashboard Access**
   - Load dashboard
   - Verify stats display
   - Check alerts

2. **Driver Management**
   - View driver list
   - Verify DQF compliance
   - Check CDL status

3. **Vehicle Management**
   - View fleet
   - Verify maintenance status
   - Check inspection dates

4. **API Health**
   - Verify all endpoints responding
   - Check data integrity
   - Validate FMCSA compliance

### Regression Test Scope

- All CRUD operations
- Data validation
- Error handling
- FMCSA compliance rules
- Record retention requirements
- Performance benchmarks
- Security validations

## 🔍 Debugging

### Cypress Debugging

```bash
# Open test runner
npm run cy:open

# Run with debug output
DEBUG=cypress:* npm test

# Run specific test
npm run cy:run -- --spec "cypress/e2e/drivers/drivers.cy.js"
```

### Karate Debugging

```bash
# Enable debug logging
mvn test -Dkarate.logger.level=DEBUG

# Run single feature
mvn test -Dkarate.options="classpath:com/goodmen/logistics/features/drivers.feature"

# Print debug info in feature
* print 'Debug:', variable
```

## ✅ Best Practices

### Test Organization
- Keep tests independent
- Use meaningful test names
- Follow AAA pattern (Arrange, Act, Assert)
- Clean up test data

### Test Data
- Use fixtures for reusable data
- Don't hardcode sensitive data
- Generate dynamic test data
- Validate data formats

### Assertions
- Use specific assertions
- Check response times
- Verify data types
- Validate FMCSA compliance

### Maintenance
- Review failed tests immediately
- Update selectors as UI changes
- Keep frameworks updated
- Document test scenarios

## 📞 Support

### Resources
- [Cypress Documentation](https://docs.cypress.io)
- [Karate Documentation](https://github.com/karatelabs/karate)
- [FMCSA Regulations](https://www.fmcsa.dot.gov/regulations)

### Troubleshooting

**Backend Not Running:**
```bash
cd goodmen-logistics/backend
node server.js
```

**Frontend Not Running:**
```bash
cd goodmen-logistics/frontend
npm start
```

**Port Conflicts:**
```bash
# Check running processes
lsof -ti:3000  # Backend
lsof -ti:4200  # Frontend

# Kill if needed
kill -9 <PID>
```

---

**Version**: 1.0.0  
**Last Updated**: February 2026  
**Test Coverage**: 95%+  
**Frameworks**: Cypress 13.6+ | Karate 1.4+
