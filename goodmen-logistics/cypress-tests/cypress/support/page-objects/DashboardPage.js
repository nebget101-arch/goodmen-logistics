import BasePage from './BasePage';

/**
 * Dashboard Page Object
 */
class DashboardPage extends BasePage {
  constructor() {
    super();
    this.url = '/';
    this.selectors = {
      statsCards: '.stat-card, .stats-card',
      alertsSection: '.alerts, .alert-section',
      chartSection: '.chart, .chart-container',
      recentActivity: '.recent-activity',
    };
  }

  /**
   * Visit dashboard page
   */
  visit() {
    super.visit(this.url);
    return this;
  }

  /**
   * Verify dashboard is loaded
   */
  verifyDashboardLoaded() {
    this.verifyPageHeader(/Dashboard|Overview/i);
    this.waitForLoading();
    return this;
  }

  /**
   * Verify stats cards are visible
   */
  verifyStatsCards() {
    cy.get(this.selectors.statsCards).should('have.length.greaterThan', 0);
    return this;
  }

  /**
   * Verify specific stat card value
   */
  verifyStatCard(label, value) {
    cy.contains(this.selectors.statsCards, label)
      .should('be.visible')
      .and('contain', value);
    return this;
  }

  /**
   * Get stat card count
   */
  getStatCardCount() {
    return cy.get(this.selectors.statsCards).its('length');
  }

  /**
   * Verify alerts section
   */
  verifyAlertsSection() {
    cy.get(this.selectors.alertsSection).should('exist');
    return this;
  }

  /**
   * Get alert count
   */
  getAlertCount() {
    return cy.get(`${this.selectors.alertsSection} .alert-item, ${this.selectors.alertsSection} li`)
      .its('length');
  }

  /**
   * Verify specific alert exists
   */
  verifyAlertExists(alertText) {
    cy.contains(this.selectors.alertsSection, alertText).should('be.visible');
    return this;
  }

  /**
   * Click on an alert
   */
  clickAlert(index) {
    cy.get(`${this.selectors.alertsSection} .alert-item, ${this.selectors.alertsSection} li`)
      .eq(index)
      .click();
    return this;
  }

  /**
   * Verify compliance overview
   */
  verifyComplianceOverview() {
    cy.contains(/compliance|status/i).should('be.visible');
    return this;
  }
}

export default DashboardPage;
