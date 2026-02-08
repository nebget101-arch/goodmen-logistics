/**
 * Base Page Object - Contains common methods for all pages
 */
class BasePage {
  constructor() {
    this.navigation = {
      dashboard: 'a[href="/"]',
      drivers: 'a[href="/drivers"]',
      vehicles: 'a[href="/vehicles"]',
      hos: 'a[href="/hos"]',
      maintenance: 'a[href="/maintenance"]',
      loads: 'a[href="/loads"]',
      audit: 'a[href="/audit"]',
    };
  }

  /**
   * Visit a specific URL
   */
  visit(url) {
    cy.visit(url);
    return this;
  }

  /**
   * Navigate using the main navigation menu
   */
  navigateToModule(module) {
    cy.get(this.navigation[module]).click();
    cy.waitForPageLoad();
    return this;
  }

  /**
   * Verify page header
   */
  verifyPageHeader(headerText) {
    cy.contains('h1, h2', headerText).should('be.visible');
    return this;
  }

  /**
   * Verify navigation is visible
   */
  verifyNavigationExists() {
    cy.get('nav').should('be.visible');
    Object.values(this.navigation).forEach((selector) => {
      cy.get(selector).should('exist');
    });
    return this;
  }

  /**
   * Click add button
   */
  clickAddButton(buttonText = 'Add') {
    cy.contains('button', buttonText).click();
    return this;
  }

  /**
   * Search in search box
   */
  searchFor(searchTerm) {
    cy.get('input[type="search"], input[placeholder*="Search"]').type(searchTerm);
    return this;
  }

  /**
   * Verify table exists and has data
   */
  verifyTableHasData() {
    cy.get('table').should('exist');
    cy.get('table tbody tr').should('have.length.greaterThan', 0);
    return this;
  }

  /**
   * Verify loading is complete
   */
  waitForLoading() {
    cy.get('.loading, .spinner', { timeout: 10000 }).should('not.exist');
    return this;
  }

  /**
   * Get table row count
   */
  getTableRowCount() {
    return cy.get('table tbody tr').its('length');
  }

  /**
   * Click on a specific row in table by index
   */
  clickTableRow(index) {
    cy.get('table tbody tr').eq(index).click();
    return this;
  }

  /**
   * Verify alert message
   */
  verifyAlertMessage(message) {
    cy.contains('.alert, .notification, .message', message).should('be.visible');
    return this;
  }

  /**
   * Close modal or dialog
   */
  closeModal() {
    cy.get('.modal .close, .dialog .close').click();
    return this;
  }
}

export default BasePage;
