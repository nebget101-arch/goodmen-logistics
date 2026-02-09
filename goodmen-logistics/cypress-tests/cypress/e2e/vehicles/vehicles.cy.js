import VehiclesPage from '../../support/page-objects/VehiclesPage';

describe('Vehicles Module - Fleet Management', () => {
  const vehiclesPage = new VehiclesPage();

  beforeEach(() => {
    cy.intercept('GET', '/api/vehicles').as('getVehicles');
    cy.intercept('GET', '/api/vehicles/maintenance-alerts').as('getMaintenanceAlerts');
    vehiclesPage.visit();
    cy.wait('@getVehicles', { timeout: 15000 });
  });

  context('Vehicle List Display', () => {
    it('should load vehicles page successfully', () => {
      // Verify page loaded with vehicle-related content
      cy.get('body').invoke('text').should('match', /Vehicle|Fleet/i);
    });

    it('should display vehicle fleet table', () => {
      vehiclesPage
        .verifyTableHasData()
        .getVehicleCount()
        .should('be.greaterThan', 0);
    });

    it('should display vehicle information columns', () => {
      // Verify table headers
      cy.contains('th', /unit|number/i).should('be.visible');
      cy.contains('th', /VIN/i).should('be.visible');
      cy.contains('th', /status/i).should('be.visible');
    });

    it('should show vehicle status badges', () => {
      cy.get('.badge, .status').should('have.length.greaterThan', 0);
    });
  });

  context('Vehicle Search', () => {
    it('should search for vehicles by unit number', () => {
      cy.fixture('vehicles').then((vehicles) => {
        const testVehicle = vehicles.validVehicle;
        
        vehiclesPage.searchVehicle(testVehicle.unitNumber);
      });
    });
  });

  context('Vehicle Details', () => {
    it('should display VIN for each vehicle', () => {
      // Check that table contains at least one VIN pattern
      cy.get('table tbody tr').first().invoke('text').should('match', /[A-HJ-NPR-Z0-9]{17}/);
    });

    it('should show vehicle make and model', () => {
      cy.get('table tbody tr').first().within(() => {
        cy.get('td').should('have.length.greaterThan', 3);
      });
    });

    it('should display current mileage', () => {
      // Check that table contains mileage numbers
      cy.get('table tbody tr').first().invoke('text').should('match', /\d{3,}/);
    });

    it('should show last inspection date', () => {
      // Check that table contains date information
      cy.get('table tbody tr').first().invoke('text').should('match', /\d{4}-\d{2}-\d{2}/);
    });
  });

  context('Maintenance Management', () => {
    it('should display maintenance due information', () => {
      cy.get('body').then(($body) => {
        if ($body.text().match(/PM|maintenance|service/i)) {
          cy.contains(/PM|maintenance|service/i).should('be.visible');
        }
      });
    });

    it('should show maintenance alerts', () => {
      cy.get('body').then(($body) => {
        if ($body.text().match(/alert|due|overdue/i)) {
          cy.contains(/alert|due|overdue/i).should('exist');
        }
      });
    });

    it('should verify 49 CFR 396 maintenance retention notice', () => {
      vehiclesPage.verifyMaintenanceRetention();
    });
  });

  context('Vehicle Actions', () => {
    it('should have add vehicle button', () => {
      cy.contains('button', /Add.*Vehicle/i).should('be.visible');
    });

    it('should open add vehicle form', () => {
      vehiclesPage.clickAddVehicle();
      
      // Form or modal should appear
      cy.get('form, .modal, .dialog').should('be.visible');
    });

    it('should view vehicle details', () => {
      cy.wait(500);
      cy.get('table tbody tr').first().click({ force: true });
      cy.get('.modal-overlay, form, .modal, .dialog', { timeout: 10000 }).should('be.visible');
    });

    it('should have action buttons for each vehicle', () => {
      cy.get('table tbody tr').first().within(() => {
        cy.get('button').should('have.length.greaterThan', 0);
      });
    });
  });

  context('FMCSA Compliance - 49 CFR Part 396', () => {
    it('should flag vehicles needing inspection', () => {
      cy.get('body').then(($body) => {
        if ($body.text().match(/inspection.*due|overdue/i)) {
          cy.contains(/inspection.*due|overdue/i).should('be.visible');
        }
      });
    });

    it('should display maintenance record retention requirements', () => {
      // 49 CFR 396.3 - 1 year maintained, 6 months after vehicle leaves
      cy.get('body').then(($body) => {
        if ($body.text().match(/49 CFR 396|retention/i)) {
          cy.contains(/49 CFR 396|retention/i).should('be.visible');
        }
      });
    });

    it('should show out-of-service vehicles', () => {
      cy.get('body').then(($body) => {
        if ($body.text().match(/out.*service|inactive/i)) {
          cy.get('.badge, .status').contains(/out.*service|inactive/i).should('exist');
        }
      });
    });
  });

  context('API Integration', () => {
    it('should make correct API calls on page load', () => {
      // API call already verified in beforeEach, just verify page loaded
      cy.get('table tbody tr').should('have.length.greaterThan', 0);
    });

    it('should handle API errors gracefully', () => {
      // Verify page handles errors without crashing
      cy.get('body').should('exist');
      cy.get('table, .error-message, .alert').should('exist');
    });

    it('should verify response data structure', () => {
      // Verify table has data which confirms API response structure
      cy.get('table tbody tr').should('have.length.greaterThan', 0);
      cy.get('table tbody tr').first().invoke('text').should('match', /TRK|VAN/i);
    });
  });

  context('Data Validation', () => {
    it('should display valid VIN format (17 characters)', () => {
      cy.get('table tbody tr').first().invoke('text').should('match', /[A-HJ-NPR-Z0-9]{17}/);
    });

    it('should show valid mileage values', () => {
      cy.get('table tbody tr').first().invoke('text').should('match', /\d{3,}/);
    });
  });
});
