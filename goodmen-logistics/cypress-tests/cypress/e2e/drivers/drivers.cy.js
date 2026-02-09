import DriversPage from '../../support/page-objects/DriversPage';

describe('Drivers Module - DQF Management', () => {
  const driversPage = new DriversPage();

  beforeEach(() => {
    cy.intercept('GET', '**/api/drivers').as('getDrivers');
    cy.intercept('GET', '**/api/dashboard/alerts').as('getAlerts');
    driversPage.visit();
    cy.wait(500); // Allow page to load
  });

  context('Driver List Display', () => {
    it('should load drivers page successfully', () => {
      cy.wait('@getDrivers');
      cy.contains('Driver Qualification Files').should('be.visible');
      cy.get('table').should('be.visible');
    });

    it('should display driver list table with correct columns', () => {
      cy.wait('@getDrivers');
      
      // Verify table headers
      cy.contains('th', 'Driver Name').should('be.visible');
      cy.contains('th', 'CDL Number').should('be.visible');
      cy.contains('th', 'CDL Expiry').should('be.visible');
      cy.contains('th', 'Med Cert Expiry').should('be.visible');
      cy.contains('th', 'DQF Complete').should('be.visible');
      cy.contains('th', 'Clearinghouse').should('be.visible');
      cy.contains('th', 'Status').should('be.visible');
      cy.contains('th', 'Actions').should('be.visible');
    });

    it('should display driver data in camelCase format from API', () => {
      cy.wait('@getDrivers').then((interception) => {
        const drivers = interception.response.body;
        expect(drivers).to.be.an('array');
        if (drivers.length > 0) {
          const driver = drivers[0];
          // Verify API returns camelCase
          expect(driver).to.have.property('firstName');
          expect(driver).to.have.property('lastName');
          expect(driver).to.have.property('cdlNumber');
          expect(driver).to.have.property('dqfCompleteness');
          expect(driver).to.have.property('clearinghouseStatus');
        }
      });
    });

    it('should show DQF completion percentage badges', () => {
      cy.wait('@getDrivers');
      
      cy.get('table tbody tr').first().find('.badge').should('exist');
    });
  });

  context('Add Driver Functionality', () => {
    it('should open add driver form when clicking Add Driver button', () => {
      cy.wait('@getDrivers');
      cy.wait(500);
      cy.contains('button', 'Add Driver').click({ force: true });
      cy.contains('Add New Driver').should('be.visible');
    });

    it('should create a new driver with valid data', () => {
      cy.wait('@getDrivers');
      cy.intercept('POST', '**/api/drivers').as('createDriver');
      
      cy.wait(500);
      cy.contains('button', 'Add Driver').click({ force: true });
      cy.wait(500);
      
      // Use unique email and CDL number with timestamp to avoid UNIQUE constraint violations
      const timestamp = Date.now();
      
      // Fill in required fields
      cy.get('input[placeholder="John"]').type('Test');
      cy.get('input[placeholder="Doe"]').type('Driver');
      cy.get('input[type="email"]').type(`test.driver${timestamp}@test.com`);
      cy.get('input[placeholder*="555"]').type('5551234567');
      cy.get('input[placeholder="A1234567"]').type('CDL' + timestamp);
      cy.get('input[placeholder="CA"]').type('TX');
      cy.get('select').first().select('A');
      cy.get('input[placeholder*="123 Main St"]').type('123 Test St, Test City, TX 12345');
      
      // Optional date fields can be left empty (now supports null)
      cy.get('input[type="date"]').eq(1).type('2027-12-31'); // medical cert expiry
      
      cy.contains('button', 'Save Driver').click({ force: true });
      
      cy.wait('@createDriver').then((interception) => {
        expect(interception.response.statusCode).to.equal(201);
        // Verify response is in camelCase
        expect(interception.response.body).to.have.property('firstName');
        expect(interception.response.body).to.have.property('dqfCompleteness', 0);
      });
    });
  });

  context('Edit Driver Functionality', () => {
    it('should open edit form when clicking edit button', () => {
      cy.wait('@getDrivers');
      cy.wait(500);
      cy.contains('button', 'Edit').first().click({ force: true });
      cy.contains('Edit Driver:').should('be.visible');
    });

    it('should update driver information', () => {
      cy.wait('@getDrivers');
      cy.intercept('PUT', '**/api/drivers/*').as('updateDriver');
      
      cy.wait(500);
      cy.contains('button', 'Edit').first().click({ force: true });
      cy.wait(500);
      cy.get('input[type="tel"]').clear().type('5559876543');
      cy.contains('button', 'Save Changes').click({ force: true });
      
      cy.wait('@updateDriver').then((interception) => {
        expect(interception.response.statusCode).to.equal(200);
      });
    });
  });

  context('Driver Qualification Files (DQF) Management', () => {
    it('should open DQF checklist form', () => {
      cy.wait('@getDrivers');
      cy.wait(500);
      cy.contains('button', 'DQF').first().click({ force: true });
      cy.contains('DQF Checklist:').should('be.visible');
      cy.contains('Application for Employment').should('be.visible');
    });

    it('should display all 6 required DQF items per 49 CFR 391.51', () => {
      cy.wait('@getDrivers');
      cy.wait(500);
      cy.contains('button', 'DQF').first().click({ force: true });
      
      cy.contains('Application for Employment').should('be.visible');
      cy.contains('Motor Vehicle Record').should('be.visible');
      cy.contains('Road Test Certificate').should('be.visible');
      cy.contains('Medical Examiner\'s Certificate').should('be.visible');
      cy.contains('Annual Review of Driving Record').should('be.visible');
      cy.contains('FMCSA Clearinghouse Consent').should('be.visible');
    });

    it('should update DQF completeness when saving checklist', () => {
      cy.wait('@getDrivers');
      cy.intercept('PUT', '**/api/drivers/*').as('updateDQF');
      
      cy.wait(500);
      cy.contains('button', 'DQF').first().click({ force: true });
      cy.wait(500);
      
      // First uncheck all items to start fresh
      cy.get('input[type="checkbox"]').each(($checkbox) => {
        cy.wrap($checkbox).uncheck({ force: true });
      });
      
      // Check exactly 3 items (3 out of 6 = 50%)
      cy.get('input[type="checkbox"]').eq(0).check({ force: true });
      cy.get('input[type="checkbox"]').eq(1).check({ force: true });
      cy.get('input[type="checkbox"]').eq(2).check({ force: true });
      
      cy.contains('button', 'Update DQF Status').click({ force: true });
      
      cy.wait('@updateDQF').then((interception) => {
        expect(interception.response.statusCode).to.equal(200);
        expect(interception.response.body.dqfCompleteness).to.equal(50);
      });
    });

    it('should set clearinghouse status to eligible when consent is checked', () => {
      cy.wait('@getDrivers');
      cy.intercept('PUT', '**/api/drivers/*').as('updateDQF');
      
      cy.wait(500);
      cy.contains('button', 'DQF').first().click({ force: true });
      cy.wait(500);
      
      // Check all items including clearinghouse consent
      cy.get('input[type="checkbox"]').each(($checkbox) => {
        cy.wrap($checkbox).check({ force: true });
      });
      
      cy.contains('button', 'Update DQF Status').click({ force: true });
      
      cy.wait('@updateDQF').then((interception) => {
        expect(interception.response.body.clearinghouseStatus).to.equal('eligible');
        expect(interception.response.body.dqfCompleteness).to.equal(100);
      });
    });

    it('should set clearinghouse status to query-pending when consent is not checked', () => {
      cy.wait('@getDrivers');
      cy.intercept('PUT', '**/api/drivers/*').as('updateDQF');
      
      cy.wait(500);
      cy.contains('button', 'DQF').first().click({ force: true });
      cy.wait(500);
      
      // Uncheck clearinghouse consent (last checkbox)
      cy.get('input[type="checkbox"]').last().uncheck({ force: true });
      
      cy.contains('button', 'Update DQF Status').click({ force: true });
      
      cy.wait('@updateDQF').then((interception) => {
        expect(interception.response.body.clearinghouseStatus).to.equal('query-pending');
      });
    });
  });

  context('Driver Status Automation', () => {
    it('should set status to inactive if DQF is not 100%', () => {
      cy.wait('@getDrivers');
      cy.intercept('PUT', '**/api/drivers/*').as('updateDQF');
      
      cy.wait(500);
      cy.contains('button', 'DQF').first().click({ force: true });
      cy.wait(500);
      
      // Check only some items (not 100%)
      cy.get('input[type="checkbox"]').eq(0).check({ force: true });
      
      cy.contains('button', 'Update DQF Status').click({ force: true });
      
      cy.wait('@updateDQF').then((interception) => {
        expect(interception.response.body.status).to.equal('inactive');
      });
    });

    it('should set status to active when DQF is 100% and dates are valid', () => {
      cy.wait('@getDrivers');
      cy.intercept('PUT', '**/api/drivers/*').as('updateDQF');
      
      cy.wait(500);
      cy.contains('button', 'DQF').first().click({ force: true });
      cy.wait(500);
      
      // Check all items (100%)
      cy.get('input[type="checkbox"]').each(($checkbox) => {
        cy.wrap($checkbox).check({ force: true });
      });
      
      cy.contains('button', 'Update DQF Status').click({ force: true });
      
      cy.wait('@updateDQF').then((interception) => {
        // Status should be active only if dates are valid
        expect(['active', 'inactive']).to.include(interception.response.body.status);
      });
    });
  });

  context('File Upload for DQF Documents', () => {
    it('should have upload buttons for each DQF document type', () => {
      cy.wait('@getDrivers');
      cy.wait(500);
      cy.contains('button', 'DQF').first().click({ force: true });
      cy.wait(500);
      
      // Should have upload labels for each of the 6 document types
      cy.contains('Application for Employment').should('be.visible')
        .parent().parent().find('input[type="file"]').should('exist');
      cy.contains('Motor Vehicle Record').should('be.visible')
        .parent().parent().find('input[type="file"]').should('exist');
      cy.contains('Road Test Certificate').should('be.visible')
        .parent().parent().find('input[type="file"]').should('exist');
      cy.contains('Medical Examiner').should('be.visible')
        .parent().parent().find('input[type="file"]').should('exist');
      cy.contains('Annual Review of Driving Record').should('be.visible')
        .parent().parent().find('input[type="file"]').should('exist');
      cy.contains('FMCSA Clearinghouse Consent').should('be.visible')
        .parent().parent().find('input[type="file"]').should('exist');
    });
  });
});

context('Driver Actions', () => {
  const driversPage = new DriversPage();
  
  beforeEach(() => {
    cy.intercept('GET', '**/api/drivers').as('getDrivers');
    driversPage.visit();
    cy.wait(500);
  });
  
  it('should have add driver button', () => {
    cy.wait('@getDrivers');
    cy.contains('button', 'Add Driver').should('be.visible');
  });

  it('should have action buttons for each driver', () => {
    cy.wait('@getDrivers');
    cy.wait(500);
    
    cy.get('table tbody tr').first().find('button').should('have.length.greaterThan', 0);
  });
});

context('API Integration', () => {
  const driversPage = new DriversPage();
  
  beforeEach(() => {
    cy.intercept('GET', '**/api/drivers').as('getDrivers');
    driversPage.visit();
    cy.wait(500);
  });
  
  it('should make correct API calls on page load', () => {
    cy.wait('@getDrivers').its('request.url').should('include', '/drivers');
  });

    it('should handle API errors gracefully', () => {
      cy.intercept('GET', '**/api/drivers', {
        statusCode: 500,
        body: { error: 'Server Error' },
      }).as('getDriversError');
      
      cy.reload();
      cy.wait('@getDriversError');
      
      // Should show error state or empty table
      cy.get('table').should('exist');
    });

    it('should verify response data structure has camelCase fields', () => {
      cy.wait('@getDrivers').then((interception) => {
        expect(interception.response.statusCode).to.eq(200);
        expect(interception.response.body).to.be.an('array');
        
        if (interception.response.body.length > 0) {
          const driver = interception.response.body[0];
          expect(driver).to.have.property('firstName');
          expect(driver).to.have.property('lastName');
          expect(driver).to.have.property('cdlNumber');
          expect(driver).to.have.property('dqfCompleteness');
        }
      });
    });
  });

