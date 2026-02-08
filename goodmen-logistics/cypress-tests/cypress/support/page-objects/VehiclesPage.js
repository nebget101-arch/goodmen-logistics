import BasePage from './BasePage';

/**
 * Vehicles Page Object - Fleet Management
 */
class VehiclesPage extends BasePage {
  constructor() {
    super();
    this.url = '/vehicles';
    this.selectors = {
      addVehicleBtn: 'button:contains("Add Vehicle"), button[class*="add"]',
      vehicleTable: 'table',
      vehicleRow: 'table tbody tr',
      searchInput: 'input[type="search"], input[placeholder*="Search"]',
      statusBadge: '.badge, .status',
    };
  }

  /**
   * Visit vehicles page
   */
  visit() {
    super.visit(this.url);
    return this;
  }

  /**
   * Verify vehicles page is loaded
   */
  verifyVehiclesPageLoaded() {
    this.verifyPageHeader(/Vehicle|Fleet/i);
    this.waitForLoading();
    return this;
  }

  /**
   * Click add vehicle button
   */
  clickAddVehicle() {
    cy.contains('button', /Add.*Vehicle/i).click();
    return this;
  }

  /**
   * Search for vehicle
   */
  searchVehicle(unitNumber) {
    this.searchFor(unitNumber);
    return this;
  }

  /**
   * Verify vehicle exists in table
   */
  verifyVehicleExists(unitNumber) {
    cy.get(this.selectors.vehicleRow).contains(unitNumber).should('be.visible');
    return this;
  }

  /**
   * Get vehicle count
   */
  getVehicleCount() {
    return cy.get(this.selectors.vehicleRow).its('length');
  }

  /**
   * Click on vehicle row by unit number
   */
  clickVehicleByUnit(unitNumber) {
    cy.get(this.selectors.vehicleRow).contains(unitNumber).click();
    return this;
  }

  /**
   * Verify vehicle status
   */
  verifyVehicleStatus(unitNumber, status) {
    cy.get(this.selectors.vehicleRow)
      .contains(unitNumber)
      .parent('tr')
      .find(this.selectors.statusBadge)
      .should('contain', status);
    return this;
  }

  /**
   * Verify VIN information
   */
  verifyVINInfo(unitNumber, vin) {
    cy.get(this.selectors.vehicleRow)
      .contains(unitNumber)
      .parent('tr')
      .should('contain', vin);
    return this;
  }

  /**
   * Verify maintenance due
   */
  verifyMaintenanceDue(unitNumber) {
    cy.get(this.selectors.vehicleRow)
      .contains(unitNumber)
      .parent('tr')
      .should('contain.text', /PM|maintenance|service/i);
    return this;
  }

  /**
   * Verify mileage information
   */
  verifyMileage(unitNumber) {
    cy.get(this.selectors.vehicleRow)
      .contains(unitNumber)
      .parent('tr')
      .should('contain.text', /\d+/); // Contains numbers (mileage)
    return this;
  }

  /**
   * Verify inspection date
   */
  verifyInspectionDate(unitNumber) {
    cy.get(this.selectors.vehicleRow)
      .contains(unitNumber)
      .parent('tr')
      .should('contain.text', /\d{1,2}\/\d{1,2}\/\d{4}|inspection/i);
    return this;
  }

  /**
   * Verify maintenance retention notice
   */
  verifyMaintenanceRetention() {
    cy.contains(/49 CFR 396|retention|maintenance record/i).should('be.visible');
    return this;
  }

  /**
   * Click maintenance button for vehicle
   */
  clickMaintenanceButton(unitNumber) {
    cy.get(this.selectors.vehicleRow)
      .contains(unitNumber)
      .parent('tr')
      .find('button')
      .contains(/maintenance|service/i)
      .click();
    return this;
  }
}

export default VehiclesPage;
