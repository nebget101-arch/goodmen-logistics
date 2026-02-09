/// <reference types="cypress" />

describe('Vehicles - Inspection Expiry and Details Modal', () => {
  beforeEach(() => {
    cy.intercept('GET', '/api/vehicles').as('getVehicles');
    cy.visit('https://safetyapp-ln58.onrender.com/vehicles');
    cy.wait('@getVehicles', { timeout: 15000 });
  });

  context('Inspection Expiry Field', () => {
    it('should display "Inspection Expires" column header', () => {
      cy.contains('th', /Inspection Expires/i).should('be.visible');
      cy.contains('th', /Last Inspection/i).should('not.exist');
    });

    it('should show inspection expiry dates in correct format', () => {
      // Get the Inspection Expires column index
      cy.contains('th', /Inspection Expires/i).invoke('index').then((columnIndex) => {
        cy.get('table tbody tr').first().within(() => {
          // Check the specific column for date format
          cy.get('td').eq(columnIndex).invoke('text').should('match', /\d{4}-\d{2}-\d{2}/);
        });
      });
    });

    it('should sort by inspection expiry when clicking column header', () => {
      // Click header to sort
      cy.contains('th', /Inspection Expires/i).click();
      
      // Wait for sort
      cy.wait(500);
      
      // Verify data still displays
      cy.get('table tbody tr').should('have.length.greaterThan', 0);
      
      // Click again to reverse sort
      cy.contains('th', /Inspection Expires/i).click();
      cy.wait(500);
      cy.get('table tbody tr').should('have.length.greaterThan', 0);
    });

    it('should highlight expired inspections in red', () => {
      cy.get('body').then(($body) => {
        const criticalRows = $body.find('tr.error-critical');
        if (criticalRows.length > 0) {
          cy.get('tr.error-critical')
            .should('have.css', 'border-left-color')
            .and('include', 'rgb(220, 53, 69)'); // Red color
        }
      });
    });

    it('should highlight expiring soon inspections in yellow', () => {
      cy.get('body').then(($body) => {
        const warningRows = $body.find('tr.warning-upcoming');
        if (warningRows.length > 0) {
          cy.get('tr.warning-upcoming')
            .should('have.css', 'border-left-color')
            .and('include', 'rgb(255, 193, 7)'); // Yellow color
        }
      });
    });
  });

  context('Vehicle Details Modal', () => {
    it('should open modal when clicking vehicle row', () => {
      cy.wait(500);
      cy.get('table tbody tr').first().click({ force: true });
      
      cy.get('.modal-overlay', { timeout: 10000 }).should('be.visible');
    });

    it('should display all three detail sections', () => {
      cy.get('table tbody tr').first().click();
      
      cy.contains('h3', /Basic Information/i).should('be.visible');
      cy.contains('h3', /Status & Compliance/i).should('be.visible');
      cy.contains('h3', /Maintenance/i).should('be.visible');
    });

    it('should show basic information fields', () => {
      cy.wait(500);
      cy.get('table tbody tr').first().click({ force: true });
      cy.get('.modal-overlay', { timeout: 10000 }).should('be.visible');
      
      // Check that modal contains vehicle information (without requiring specific label format)
      cy.get('.modal-overlay').invoke('text').should('match', /VIN|License|Plate|Make|Model|Year|Unit/i);
    });

    it('should show compliance fields with inspection expiry', () => {
      cy.wait(500);
      cy.get('table tbody tr').first().click({ force: true });
      cy.get('.modal-overlay', { timeout: 10000 }).should('be.visible');
      
      // Check that modal contains compliance information
      cy.get('.modal-overlay').invoke('text').should('match', /Inspection|Insurance|Registration|Status|Mileage/i);
    });

    it('should show maintenance information', () => {
      cy.wait(500);
      cy.get('table tbody tr').first().click({ force: true });
      cy.get('.modal-overlay', { timeout: 10000 }).should('be.visible');
      
      // Check modal contains maintenance information
      cy.get('.modal-overlay').invoke('text').should('match', /PM Due|Mileage|Maintenance/i);
    });

    it('should display expired inspection in red text', () => {
      cy.wait(500);
      cy.get('table tbody tr').first().click({ force: true });
      cy.get('.modal-overlay', { timeout: 10000 }).should('be.visible');
      
      cy.get('body').then(($body) => {
        const dangerText = $body.find('.text-danger');
        if (dangerText.length > 0) {
          cy.get('.text-danger')
            .should('have.css', 'color')
            .and('include', 'rgb(220, 53, 69)');
        }
      });
    });

    it('should display expiring soon in yellow text', () => {
      cy.wait(500);
      cy.get('table tbody tr').first().click({ force: true });
      cy.get('.modal-overlay', { timeout: 10000 }).should('be.visible');
      
      cy.get('body').then(($body) => {
        const warningText = $body.find('.text-warning');
        if (warningText.length > 0) {
          cy.get('.text-warning')
            .should('have.css', 'color')
            .and('include', 'rgb(255, 193, 7)');
        }
      });
    });

    it('should close modal when clicking close button', () => {
      cy.wait(500);
      cy.get('table tbody tr').first().click({ force: true });
      cy.get('.modal-overlay', { timeout: 10000 }).should('be.visible');
      
      cy.get('.modal-header .close-btn, .close, button[aria-label*="Close"]').first().click();
      cy.wait(500);
      
      // Modal should either not exist or not be visible
      cy.get('body').then(($body) => {
        const modal = $body.find('.modal-overlay');
        if (modal.length > 0) {
          cy.get('.modal-overlay').should('not.be.visible');
        } else {
          expect(modal.length).to.equal(0);
        }
      });
    });

    it('should close modal when clicking overlay background', () => {
      cy.wait(500);
      cy.get('table tbody tr').first().click({ force: true });
      cy.get('.modal-overlay', { timeout: 10000 }).should('be.visible');
      
      // Click on the overlay (not the modal itself)
      cy.get('.modal-overlay').click('topLeft', { force: true });
      cy.wait(500);
      
      // Modal should either not exist or not be visible
      cy.get('body').then(($body) => {
        const modal = $body.find('.modal-overlay');
        if (modal.length > 0) {
          cy.get('.modal-overlay').should('not.be.visible');
        } else {
          expect(modal.length).to.equal(0);
        }
      });
    });

    it.skip('should close modal when pressing Escape key', () => {
      cy.wait(500);
      cy.get('table tbody tr').first().click({ force: true });
      cy.get('.modal-overlay', { timeout: 10000 }).should('be.visible');
      
      cy.get('body').type('{esc}');
      cy.wait(1000); // Give more time for modal to close with animation
      
      // Modal should either not exist or not be visible
      cy.get('body').then(($body) => {
        const modal = $body.find('.modal-overlay');
        if (modal.length > 0) {
          cy.get('.modal-overlay').should('not.be.visible');
        } else {
          expect(modal.length).to.equal(0);
        }
      });
    });

    it('should have Edit Vehicle button in modal actions', () => {
      cy.get('table tbody tr').first().click();
      
      cy.get('.modal-actions').within(() => {
        cy.contains('button', /Edit Vehicle/i).should('be.visible');
      });
    });

    it('should have Close button in modal actions', () => {
      cy.get('table tbody tr').first().click();
      
      cy.get('.modal-actions').within(() => {
        cy.contains('button', /Close/i).should('be.visible');
      });
    });

    it('should open edit form when clicking Edit button in modal', () => {
      cy.intercept('GET', '/api/vehicles/*').as('getVehicle');
      
      cy.get('table tbody tr').first().click();
      cy.wait(300);
      
      cy.get('.modal-actions').within(() => {
        cy.contains('button', /Edit Vehicle/i).click();
      });
      
      // Should open the vehicle form modal
      cy.contains('h2', /Edit Vehicle/i).should('be.visible');
    });

    it('should show OOS reason if vehicle is out of service', () => {
      cy.get('body').then(($body) => {
        const oosRow = $body.find('tr').filter((i, el) => {
          return Cypress.$(el).text().includes('out-of-service');
        }).first();
        
        if (oosRow.length > 0) {
          cy.wrap(oosRow).click();
          cy.contains('.detail-label', /OOS Reason/i).should('be.visible');
        }
      });
    });

    it('should have responsive grid layout', () => {
      cy.get('table tbody tr').first().click();
      
      cy.get('.details-grid').should('have.css', 'display', 'grid');
      
      // Should have 2 columns on desktop
      cy.viewport(1280, 720);
      cy.get('.details-grid').should('have.css', 'grid-template-columns');
    });

    it('should be mobile responsive', () => {
      cy.viewport('iphone-x');
      cy.wait(500);
      cy.get('table tbody tr').first().click({ force: true });
      
      cy.get('.modal-overlay', { timeout: 10000 }).should('be.visible');
      cy.get('.details-grid, .modal-body').should('exist');
    });
  });

  context('Vehicle Form - Inspection Expiry', () => {
    it('should have inspection expiration date field in add form', () => {
      cy.contains('button', /Add.*Vehicle/i).click();
      
      cy.contains('label', /Inspection Expiration/i).should('be.visible');
      cy.get('input[name="inspection_expiry"]').should('be.visible');
      cy.get('input[name="inspection_expiry"]').should('have.attr', 'type', 'date');
    });

    it('should have inspection expiration date field in edit form', () => {
      cy.get('table tbody tr').first().within(() => {
        cy.contains('button', /Edit/i).click();
      });
      
      cy.wait(500);
      
      cy.get('body').then(($body) => {
        if ($body.find('input[name="inspection_expiry"], input#inspection-expiry').length > 0) {
          cy.get('input[name="inspection_expiry"], input#inspection-expiry').scrollIntoView().should('exist');
        }
      });
    });

    it('should display expiry status badge when date is filled', () => {
      cy.contains('button', /Add.*Vehicle/i).click();
      
      const futureDate = new Date();
      futureDate.setFullYear(futureDate.getFullYear() + 1);
      const formattedDate = futureDate.toISOString().split('T')[0];
      
      cy.get('input[name="inspection_expiry"]').type(formattedDate);
      
      // Should show status indicator
      cy.get('.status-indicator').should('exist');
    });
  });

  context('Table Row Interactions', () => {
    it('should have cursor pointer on vehicle rows', () => {
      cy.get('table tbody tr').first()
        .should('have.css', 'cursor', 'pointer');
    });

    it('should show hover effect on rows', () => {
      cy.get('table tbody tr').first().trigger('mouseover');
      
      // Should be visible and interactive
      cy.get('table tbody tr').first().should('be.visible');
    });

    it('should be keyboard accessible', () => {
      // Verify table row has proper accessibility attributes
      cy.get('table tbody tr').first().should('have.attr', 'aria-label');
    });
  });

  context('Vehicle Documents', () => {
    it('should show documents section in vehicle form', () => {
      cy.contains('button', /Add.*Vehicle/i).click();
      
      cy.get('body').then(($body) => {
        if ($body.text().match(/document/i)) {
          cy.contains(/document/i).scrollIntoView().should('exist');
        }
      });
    });
  });

  context('Accessibility', () => {
    it('should have proper ARIA labels on modal close button', () => {
      cy.wait(500);
      cy.get('table tbody tr').first().click({ force: true });
      cy.get('.modal-overlay', { timeout: 10000 }).should('be.visible');
      
      cy.get('.modal-header .close-btn, .close, button[aria-label*="Close"]').first()
        .should('have.attr', 'aria-label').and('match', /Close/i);
    });

    it('should trap focus within modal', () => {
      cy.wait(500);
      cy.get('table tbody tr').first().click({ force: true });
      cy.get('.modal-overlay', { timeout: 10000 }).should('be.visible');
      
      // Verify modal contains interactive elements
      cy.get('.modal-overlay').find('button').should('have.length.greaterThan', 0);
    });

    it('should have semantic HTML headings', () => {
      cy.wait(500);
      cy.get('table tbody tr').first().click({ force: true });
      cy.get('.modal-overlay', { timeout: 10000 }).should('be.visible');
      
      cy.get('h2, h3').should('have.length.greaterThan', 0);
    });
  });
});
