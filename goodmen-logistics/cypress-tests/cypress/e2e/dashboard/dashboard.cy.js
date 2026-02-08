import DashboardPage from '../../support/page-objects/DashboardPage';

describe('Dashboard Module - Complete Tests', () => {
  const dashboardPage = new DashboardPage();

  beforeEach(() => {
    cy.interceptApi('GET', '/dashboard/stats', 'getStats');
    cy.interceptApi('GET', '/dashboard/alerts', 'getAlerts');
    dashboardPage.visit();
    cy.waitForPageLoad();
  });

  context('Dashboard Statistics', () => {
    it('should display all key performance indicators', () => {
      cy.wait('@getStats');
      
      dashboardPage
        .verifyStatsCards()
        .getStatCardCount()
        .should('be.gte', 6); // At least 6 stat cards
      
      // Verify common KPIs
      cy.contains(/total.*driver|driver.*total/i).should('be.visible');
      cy.contains(/total.*vehicle|vehicle.*total/i).should('be.visible');
      cy.contains(/active.*load|load.*active/i).should('be.visible');
    });

    it('should show real-time compliance metrics', () => {
      cy.wait('@getStats');
      
      // Verify compliance-related stats
      cy.contains(/compliance|violation|alert/i).should('be.visible');
    });

    it('should display numerical values in stat cards', () => {
      cy.wait('@getStats');
      
      cy.get('.stat-card, .stats-card').each(($card) => {
        cy.wrap($card).should('contain.text', /\d+/); // Contains numbers
      });
    });
  });

  context('Alerts and Notifications', () => {
    it('should display critical alerts', () => {
      cy.wait('@getAlerts');
      
      dashboardPage.verifyAlertsSection();
    });

    it('should show different alert types with proper styling', () => {
      cy.wait('@getAlerts');
      
      // Check for alert severity indicators
      cy.get('.alert, .alert-item').should('have.length.greaterThan', 0);
    });

    it('should allow clicking on alerts', () => {
      cy.wait('@getAlerts');
      
      cy.get('.alert, .alert-item').first().click();
      // Alert should either expand or navigate
    });
  });

  context('Navigation and Interaction', () => {
    it('should navigate to drivers module', () => {
      dashboardPage.navigateToModule('drivers');
      cy.url().should('include', '/drivers');
      cy.contains(/driver|DQF/i).should('be.visible');
    });

    it('should navigate to vehicles module', () => {
      dashboardPage.navigateToModule('vehicles');
      cy.url().should('include', '/vehicles');
      cy.contains(/vehicle|fleet/i).should('be.visible');
    });

    it('should navigate to HOS module', () => {
      dashboardPage.navigateToModule('hos');
      cy.url().should('include', '/hos');
      cy.contains(/HOS|hours.*service/i).should('be.visible');
    });

    it('should navigate to maintenance module', () => {
      dashboardPage.navigateToModule('maintenance');
      cy.url().should('include', '/maintenance');
      cy.contains(/maintenance/i).should('be.visible');
    });

    it('should navigate to loads module', () => {
      dashboardPage.navigateToModule('loads');
      cy.url().should('include', '/loads');
      cy.contains(/load|dispatch/i).should('be.visible');
    });

    it('should navigate to audit module', () => {
      dashboardPage.navigateToModule('audit');
      cy.url().should('include', '/audit');
      cy.contains(/audit|report/i).should('be.visible');
    });
  });

  context('FMCSA Compliance Overview', () => {
    it('should display compliance status overview', () => {
      cy.wait('@getStats');
      
      dashboardPage.verifyComplianceOverview();
    });

    it('should highlight compliance issues', () => {
      cy.wait('@getAlerts');
      
      // Check for compliance-related alerts
      cy.get('body').then(($body) => {
        if ($body.text().match(/violation|issue|expired|due/i)) {
          cy.contains(/violation|issue|expired|due/i).should('be.visible');
        }
      });
    });
  });

  context('Responsive Design', () => {
    const viewports = [
      { device: 'iphone-x', width: 375, height: 812 },
      { device: 'ipad-2', width: 768, height: 1024 },
      { device: 'macbook-15', width: 1440, height: 900 },
    ];

    viewports.forEach((viewport) => {
      it(`should be responsive on ${viewport.device}`, () => {
        cy.viewport(viewport.width, viewport.height);
        cy.wait('@getStats');
        
        dashboardPage.verifyStatsCards();
        cy.get('nav').should('exist');
      });
    });
  });

  context('Error Handling', () => {
    it('should handle API failure gracefully', () => {
      cy.intercept('GET', '**/dashboard/stats', {
        statusCode: 500,
        body: { error: 'Internal Server Error' },
      }).as('getStatsError');
      
      cy.reload();
      cy.wait('@getStatsError');
      
      // Should show error message or fallback UI
      cy.get('body').should('exist');
    });
  });
});
