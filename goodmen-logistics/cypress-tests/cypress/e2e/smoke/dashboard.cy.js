import DashboardPage from '../../support/page-objects/DashboardPage';

describe('Dashboard - Smoke Tests', () => {
  const dashboardPage = new DashboardPage();

  beforeEach(() => {
    // Intercept API calls
    cy.interceptApi('GET', '/dashboard/stats', 'getDashboardStats');
    cy.interceptApi('GET', '/dashboard/alerts', 'getDashboardAlerts');
    
    dashboardPage.visit();
  });

  it('should load dashboard page successfully', () => {
    dashboardPage
      .verifyDashboardLoaded()
      .verifyNavigationExists();
  });

  it('should display dashboard statistics cards', () => {
    cy.waitForApi('getDashboardStats');
    
    dashboardPage
      .verifyStatsCards()
      .getStatCardCount()
      .should('be.greaterThan', 0);
  });

  it('should display alerts section', () => {
    cy.waitForApi('getDashboardAlerts');
    
    dashboardPage.verifyAlertsSection();
  });

  it('should navigate to different modules from dashboard', () => {
    cy.contains('Drivers').click();
    cy.url().should('include', '/drivers');
    
    cy.go('back');
    cy.contains('Vehicles').click();
    cy.url().should('include', '/vehicles');
  });

  it('should verify dashboard API responses', () => {
    cy.verifyApiResponse('@getDashboardStats', 200, 'object');
    cy.verifyApiResponse('@getDashboardAlerts', 200, 'array');
  });
});
