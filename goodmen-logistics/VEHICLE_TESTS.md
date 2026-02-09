# Test Suite for Vehicle Changes

This document describes the comprehensive test coverage for the vehicle inspection_expiry field rename and vehicle details modal feature.

## Overview of Changes Tested

1. **Field Rename**: `last_inspection_date` → `inspection_expiry`
2. **Vehicle Details Modal**: Clickable rows with detailed information view
3. **Vehicle Documents**: Document management with expiry tracking
4. **Expiry Warnings**: 60-day warnings and expired status indicators

---

## 1. Karate API Tests

**Location**: `karate-tests/src/test/java/com/goodmen/logistics/features/vehicles.feature`

### Test Scenarios

#### ✅ Updated Core Scenarios
- **Get All Vehicles**: Validates `inspection_expiry` field exists (not `last_inspection_date`)
- **Get Vehicle by ID**: Verifies individual vehicle has correct field structure
- **Create Vehicle**: Tests creating vehicle with `inspection_expiry` date
- **Update Vehicle**: Tests updating `inspection_expiry` and mileage
- **Delete Vehicle**: Cleanup test data

#### ✅ New Inspection Expiry Scenarios
- **Verify Inspection Expiry Format**: Validates date format (YYYY-MM-DD)
- **Get Expired Inspections**: Filters vehicles with expired inspections
- **Sort by Inspection Expiry**: Tests sorting functionality

#### ✅ Vehicle Documents Scenarios
- **List Documents**: GET `/api/vehicles/:id/documents`
- **Create Document**: POST with vehicle_id, file details, expiry_date
- **Delete Document**: DELETE `/api/vehicles/:id/documents/:docId`
- **Non-existent Vehicle**: Error handling for invalid IDs

### Running Karate Tests

```bash
cd goodmen-logistics/karate-tests
mvn test

# Run specific feature
mvn test -Dkarate.options="classpath:com/goodmen/logistics/features/vehicles.feature"

# Run with tags
mvn test -Dkarate.options="--tags @vehicles --tags @documents"
```

### Expected Results
- All tests should pass with `inspection_expiry` field
- No tests should reference `last_inspection_date`
- Document CRUD operations should work correctly
- Date format validation should pass

---

## 2. Cypress E2E Tests

**Location**: `cypress-tests/cypress/e2e/vehicles/vehicle-details-modal.cy.js`

### Test Scenarios

#### ✅ Inspection Expiry Field (5 tests)
- Display "Inspection Expires" column header
- Show dates in correct format (YYYY-MM-DD or MM/DD/YYYY)
- Sort by inspection expiry date
- Highlight expired inspections (red border)
- Highlight expiring soon (yellow border, 60 days)

#### ✅ Vehicle Details Modal (12 tests)
- Open modal when clicking vehicle row
- Display three sections: Basic Info, Status & Compliance, Maintenance
- Show all basic information fields (Unit #, VIN, Make, Model, Year, Plate, State)
- Show compliance fields including `inspection_expiry`
- Show maintenance fields (Next PM Due, Next PM Mileage)
- Display expired inspection in red text
- Display expiring soon in yellow text
- Close modal via close button
- Close modal via overlay click
- Close modal via Escape key
- Edit button opens vehicle form
- Show OOS reason if applicable

#### ✅ Table Interactions (3 tests)
- Rows have cursor:pointer
- Hover effects work
- Keyboard accessible

#### ✅ Vehicle Form (3 tests)
- Add form has inspection expiration date field
- Edit form has inspection expiration date field
- Status badge displays when date filled

#### ✅ Accessibility (3 tests)
- ARIA labels on buttons
- Focus trap within modal
- Semantic HTML headings

### Running Cypress Tests

```bash
cd goodmen-logistics/cypress-tests

# Interactive mode
npm run cypress:open

# Headless mode
npm run cypress:run

# Specific spec file
npx cypress run --spec "cypress/e2e/vehicles/vehicle-details-modal.cy.js"

# With browser
npx cypress run --browser chrome --spec "cypress/e2e/vehicles/vehicle-details-modal.cy.js"
```

### Prerequisites
- Frontend running on `http://localhost:4200`
- Backend API running on `http://localhost:3000`
- Test data seeded in database

### Expected Results
- All 29 tests should pass
- Modal animations should be smooth
- Color coding should match specifications:
  - Expired: Red (#dc3545)
  - Warning: Yellow (#ffc107)
  - Valid: No special color

---

## 3. K6 Performance Tests

**Location**: `k6-performance-tests/tests/vehicles-performance.test.js`

### Test Scenarios

#### ✅ Vehicle List Operations (4 checks)
- Returns 200 status
- Response is array
- Vehicles have `inspection_expiry` field
- No `last_inspection_date` field present

#### ✅ Vehicle Details (4 checks)
- Returns 200 status
- Has `inspection_expiry` field
- Date format is valid (YYYY-MM-DD)
- Has required compliance fields

#### ✅ Sorting & Filtering (2 scenarios)
- Sort by `inspection_expiry` ascending/descending
- Filter by status

#### ✅ CRUD Operations
- **Create**: Vehicle with `inspection_expiry`
- **Update**: Modify `inspection_expiry` value
- **Delete**: Cleanup test data

#### ✅ Document Operations
- List vehicle documents
- Create document with expiry_date
- Delete document

### Performance Thresholds

```javascript
thresholds: {
  http_req_failed: ['rate<0.05'],           // < 5% failures
  http_req_duration: ['p(95)<2000'],        // 95% under 2s
  http_req_duration: ['p(99)<3000'],        // 99% under 3s
  'vehicles endpoint': ['p(95)<1500'],       // Vehicles under 1.5s
  'documents endpoint': ['p(95)<1000'],      // Documents under 1s
}
```

### Load Profile

```
Stage 1: 30s ramp-up to 10 VUs
Stage 2: 1m steady state at 10 VUs
Stage 3: 20s ramp-down to 0 VUs
```

### Running K6 Tests

```bash
cd k6-performance-tests

# Run vehicles performance test
k6 run tests/vehicles-performance.test.js

# With custom VUs/duration
k6 run --vus 20 --duration 2m tests/vehicles-performance.test.js

# Generate report
k6 run --out json=reports/vehicles-perf.json tests/vehicles-performance.test.js

# Run against production
BASE_URL=https://safetyapp-ln58.onrender.com k6 run tests/vehicles-performance.test.js
```

### Expected Results
- All HTTP requests should succeed (< 5% failure rate)
- P95 response time < 2000ms
- P99 response time < 3000ms
- No memory leaks or connection issues
- Document operations complete successfully

---

## Test Coverage Summary

| Category | Karate | Cypress | K6 | Total |
|----------|--------|---------|----|----|
| **Inspection Expiry** | 4 | 5 | 4 | **13** |
| **Details Modal** | - | 12 | - | **12** |
| **Vehicle CRUD** | 5 | 3 | 5 | **13** |
| **Documents** | 4 | 1 | 3 | **8** |
| **Accessibility** | - | 3 | - | **3** |
| **Performance** | 2 | - | 8 | **10** |
| **Total** | **15** | **24** | **20** | **59** |

---

## Running All Tests

### 1. Prepare Environment

```bash
# Start backend
cd goodmen-logistics/backend
npm start

# Start frontend (new terminal)
cd goodmen-logistics/frontend
npm start

# Ensure database is migrated
psql -U postgres -d safetyapp -f backend/database/migrate-inspection-field.sql
```

### 2. Run Test Suites

```bash
# Karate API Tests
cd karate-tests
mvn test

# Cypress E2E Tests
cd cypress-tests
npm run cypress:run

# K6 Performance Tests
cd k6-performance-tests
k6 run tests/vehicles-performance.test.js
```

### 3. Review Results

- **Karate**: Check `karate-tests/target/karate-reports/`
- **Cypress**: Check `cypress-tests/cypress/videos/` and `cypress-tests/cypress/screenshots/`
- **K6**: Check `k6-performance-tests/reports/vehicles-performance.json`

---

## Continuous Integration

### Add to CI/CD Pipeline

```yaml
# .github/workflows/test.yml
name: Test Suite

on: [push, pull_request]

jobs:
  api-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - name: Run Karate Tests
        run: |
          cd karate-tests
          mvn test

  e2e-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - name: Run Cypress Tests
        run: |
          cd cypress-tests
          npm ci
          npm run cypress:run

  performance-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - name: Run K6 Tests
        run: |
          cd k6-performance-tests
          k6 run tests/vehicles-performance.test.js
```

---

## Test Maintenance

### When to Update Tests

1. **API Schema Changes**: Update Karate response matchers
2. **UI Changes**: Update Cypress selectors and assertions
3. **Performance Requirements**: Adjust K6 thresholds
4. **New Features**: Add corresponding test scenarios

### Test Data Management

- Use factory patterns for test data generation
- Clean up test vehicles/documents after tests
- Use unique identifiers (timestamps, VU numbers)
- Maintain separate test database for Cypress

---

## Troubleshooting

### Common Issues

**Karate Tests Fail**
- Verify backend is running on correct port
- Check database has been migrated
- Ensure test data exists

**Cypress Tests Timeout**
- Increase `defaultCommandTimeout` in cypress.config.js
- Check frontend is built and running
- Verify API endpoints are responding

**K6 Tests Fail**
- Check BASE_URL environment variable
- Verify server can handle load
- Review threshold settings

---

## Related Documentation

- [INSPECTION_FIELD_UPDATE.md](../goodmen-logistics/INSPECTION_FIELD_UPDATE.md) - Field rename documentation
- [API_TESTING.md](../goodmen-logistics/API_TESTING.md) - API testing guide
- [TESTING-GUIDE.md](../goodmen-logistics/TESTING-GUIDE.md) - General testing guide

---

**Created**: February 8, 2026  
**Last Updated**: February 8, 2026  
**Version**: 1.0.0
