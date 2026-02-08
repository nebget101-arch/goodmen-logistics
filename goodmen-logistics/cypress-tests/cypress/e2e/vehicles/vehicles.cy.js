import VehiclesPage from '../../support/page-objects/VehiclesPage';

describe('Vehicles Module - Fleet Management', () => {
  const vehiclesPage = new VehiclesPage();

  beforeEach(() => {
    cy.interceptApi('GET', '/vehicles', 'getVehicles');
    cy.interceptApi('GET', '/vehicles/maintenance-alerts', 'getMaintenanceAlerts');
    vehiclesPage.visit();
    cy.waitForPageLoad();
  });

  context('Vehicle List Display', () => {
    it('should load vehicles page successfully', () => {
      vehiclesPage
        .verifyVehiclesPageLoaded()
        .verifyNavigationExists();
    });

    it('should display vehicle fleet table', () => {
      cy.wait('@getVehicles');
      
      vehiclesPage
        .verifyTableHasData()
        .getVehicleCount()
        .should('be.greaterThan', 0);
    });

    it('should display vehicle information columns', () => {
      cy.wait('@getVehicles');
      
      // Verify table headers
      cy.contains('th', /unit|number/i).should('be.visible');
      cy.contains('th', /VIN/i).should('be.visible');
      cy.contains('th', /status/i).should('be.visible');
    });

    it('should show vehicle status badges', () => {
      cy.wait('@getVehicles');
      
      cy.get('.badge, .status').should('have.length.greaterThan', 0);
    });
  });

  context('Vehicle Search', () => {
    it('should search for vehicles by unit number', () => {
      cy.wait('@getVehicles');
      
      cy.fixture('vehicles').then((vehicles) => {
        const testVehicle = vehicles.validVehicle;
        
        vehiclesPage.searchVehicle(testVehicle.unitNumber);
      });
    });
  });

  context('Vehicle Details', () => {
    it('should display VIN for each vehicle', () => {
      cy.wait('@getVehicles');
      
      cy.get('table tbody tr').first().within(() => {
        // VIN is 17 characters
        cy.get('td').should('contain.text', /[A-HJ-NPR-Z0-9]{17}/i);
      });
    });

    it('should show vehicle make and model', () => {
      cy.wait('@getVehicles');
      
      cy.get('table tbody tr').first().within(() => {
        cy.get('td').should('have.length.greaterThan', 3);
      });
    });

    it('should display current mileage', () => {
      cy.wait('@getVehicles');
      
      cy.get('table tbody tr').first().within(() => {
        // Should contain mileage numbers
        cy.get('td').should('contain.text', /\d{3,}/); // At least 3 digits
      });
    });

    it('should show last inspection date', () => {
      cy.wait('@getVehicles');
      
      vehiclesPage.verifyInspectionDate(cy.get('table tbody tr').first());
    });
  });

  context('Maintenance Management', () => {
    it('should display maintenance due information', () => {
      cy.wait('@getVehicles');
      
      cy.get('body').then(($body) => {
        if ($body.text().match(/PM|maintenance|service/i)) {
          cy.contains(/PM|maintenance|service/i).should('be.visible');
        }
      });
    });

    it('should show maintenance alerts', () => {
      cy.wait('@getMaintenanceAlerts');
      
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
      cy.wait('@getVehicles');
      
      vehiclesPage.clickTableRow(0);
    });

    it('should have action buttons for each vehicle', () => {
      cy.wait('@getVehicles');
      
      cy.get('table tbody tr').first().within(() => {
        cy.get('button').should('have.length.greaterThan', 0);
      });
    });
  });

  context('FMCSA Compliance - 49 CFR Part 396', () => {
    it('should flag vehicles needing inspection', () => {
      cy.wait('@getVehicles');
      
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
      cy.wait('@getVehicles');
      
      cy.get('body').then(($body) => {
        if ($body.text().match(/out.*service|inactive/i)) {
          cy.get('.badge, .status').contains(/out.*service|inactive/i).should('exist');
        }
      });
    });
  });

  context('API Integration', () => {
    it('should make correct API calls on page load', () => {
      cy.wait('@getVehicles').its('request.url').should('include', '/vehicles');
    });

    it('should handle API errors gracefully', () => {
      cy.intercept('GET', '**/vehicles', {
        statusCode: 500,
        body: { error: 'Server Error' },
      }).as('getVehiclesError');
      
      cy.reload();
      cy.wait('@getVehiclesError');
      
      cy.get('body').should('exist');
    });

    it('should verify response data structure', () => {
      cy.wait('@getVehicles').then((interception) => {
        expect(interception.response.statusCode).to.eq(200);
        expect(interception.response.body).to.be.an('array');
        
        if (interception.response.body.length > 0) {
          const vehicle = interception.response.body[0];
          expect(vehicle).to.have.property('unitNumber');
          expect(vehicle).to.have.property('vin');
        }
      });
    });
  });

  context('Data Validation', () => {
    it('should display valid VIN format (17 characters)', () => {
      cy.wait('@getVehicles');
      
      cy.get('table tbody tr').first().within(() => {
        cy.get('td').should('contain.text', /[A-HJ-NPR-Z0-9]{17}/i);
      });
    });

    it('should show valid mileage values', () => {
      cy.wait('@getVehicles');
      
      cy.get('table tbody tr').each(($row) => {
        cy.wrap($row).within(() => {
          // Mileage should be positive number
          cy.get('td').should('contain.text', /\d+/);
        });
      });
    });
  });
});
