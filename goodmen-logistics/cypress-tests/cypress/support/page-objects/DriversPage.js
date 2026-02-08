import BasePage from './BasePage';

/**
 * Drivers Page Object - Driver Qualification Files Management
 */
class DriversPage extends BasePage {
  constructor() {
    super();
    this.url = '/drivers';
    this.selectors = {
      addDriverBtn: 'button:contains("Add Driver"), button[class*="add"]',
      driverTable: 'table',
      driverRow: 'table tbody tr',
      searchInput: 'input[type="search"], input[placeholder*="Search"]',
      statusBadge: '.badge, .status',
      editButton: 'button:contains("Edit")',
      deleteButton: 'button:contains("Delete")',
      viewButton: 'button:contains("View")',
    };
  }

  /**
   * Visit drivers page
   */
  visit() {
    super.visit(this.url);
    return this;
  }

  /**
   * Verify drivers page is loaded
   */
  verifyDriversPageLoaded() {
    this.verifyPageHeader(/Driver|DQF/i);
    this.waitForLoading();
    return this;
  }

  /**
   * Click add driver button
   */
  clickAddDriver() {
    cy.contains('button', /Add.*Driver/i).click();
    return this;
  }

  /**
   * Search for driver
   */
  searchDriver(driverName) {
    this.searchFor(driverName);
    return this;
  }

  /**
   * Verify driver exists in table
   */
  verifyDriverExists(driverName) {
    cy.get(this.selectors.driverRow).contains(driverName).should('be.visible');
    return this;
  }

  /**
   * Get driver count
   */
  getDriverCount() {
    return cy.get(this.selectors.driverRow).its('length');
  }

  /**
   * Click on driver row by name
   */
  clickDriverByName(driverName) {
    cy.get(this.selectors.driverRow).contains(driverName).click();
    return this;
  }

  /**
   * Verify driver status
   */
  verifyDriverStatus(driverName, status) {
    cy.get(this.selectors.driverRow)
      .contains(driverName)
      .parent('tr')
      .find(this.selectors.statusBadge)
      .should('contain', status);
    return this;
  }

  /**
   * Verify CDL information
   */
  verifyCDLInfo(driverName, cdlNumber) {
    cy.get(this.selectors.driverRow)
      .contains(driverName)
      .parent('tr')
      .should('contain', cdlNumber);
    return this;
  }

  /**
   * Verify medical certificate expiration
   */
  verifyMedicalCertExpiration(driverName) {
    cy.get(this.selectors.driverRow)
      .contains(driverName)
      .parent('tr')
      .should('contain.text', /\d{1,2}\/\d{1,2}\/\d{4}/); // Date pattern
    return this;
  }

  /**
   * Click edit button for specific driver
   */
  clickEditDriver(driverName) {
    cy.get(this.selectors.driverRow)
      .contains(driverName)
      .parent('tr')
      .find('button')
      .contains(/Edit|Modify/i)
      .click();
    return this;
  }

  /**
   * Click view button for specific driver
   */
  clickViewDriver(driverName) {
    cy.get(this.selectors.driverRow)
      .contains(driverName)
      .parent('tr')
      .find('button')
      .contains(/View|Details/i)
      .click();
    return this;
  }

  /**
   * Verify compliance issues section
   */
  verifyComplianceIssues() {
    cy.contains(/compliance|issue|violation/i).should('exist');
    return this;
  }

  /**
   * Filter by status
   */
  filterByStatus(status) {
    cy.get('select, .filter').select(status);
    return this;
  }
}

export default DriversPage;
