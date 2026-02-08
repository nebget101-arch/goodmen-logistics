// ***********************************************
// Custom commands for Goodmen Logistics Testing
// ***********************************************

/**
 * Navigate to specific module
 * @example cy.navigateTo('drivers')
 */
Cypress.Commands.add('navigateTo', (module) => {
  const routes = {
    dashboard: '/',
    drivers: '/drivers',
    vehicles: '/vehicles',
    hos: '/hos',
    maintenance: '/maintenance',
    loads: '/loads',
    audit: '/audit'
  };
  
  cy.visit(routes[module] || routes.dashboard);
  cy.wait(500); // Wait for page to stabilize
});

/**
 * API request helper with default configuration
 * @example cy.apiRequest('GET', '/drivers')
 */
Cypress.Commands.add('apiRequest', (method, endpoint, body = null) => {
  const apiUrl = Cypress.config('apiUrl') || Cypress.env('apiUrl');
  
  return cy.request({
    method,
    url: `${apiUrl}${endpoint}`,
    body,
    failOnStatusCode: false,
    headers: {
      'Content-Type': 'application/json',
    },
  });
});

/**
 * Wait for API response
 * @example cy.waitForApi('drivers')
 */
Cypress.Commands.add('waitForApi', (alias) => {
  cy.wait(`@${alias}`, { timeout: 10000 });
});

/**
 * Check if table has data
 * @example cy.verifyTableHasData('table')
 */
Cypress.Commands.add('verifyTableHasData', (selector = 'table') => {
  cy.get(selector).should('exist');
  cy.get(`${selector} tbody tr`).should('have.length.greaterThan', 0);
});

/**
 * Check loading spinner appears and disappears
 * @example cy.verifyLoadingComplete()
 */
Cypress.Commands.add('verifyLoadingComplete', () => {
  cy.get('.loading', { timeout: 1000 }).should('not.exist');
});

/**
 * Verify navigation menu is visible
 * @example cy.verifyNavigation()
 */
Cypress.Commands.add('verifyNavigation', () => {
  cy.get('nav').should('be.visible');
  cy.contains('Dashboard').should('be.visible');
  cy.contains('Drivers').should('be.visible');
  cy.contains('Vehicles').should('be.visible');
  cy.contains('HOS').should('be.visible');
});

/**
 * Verify page title
 * @example cy.verifyPageTitle('Dashboard')
 */
Cypress.Commands.add('verifyPageTitle', (title) => {
  cy.contains(title).should('be.visible');
});

/**
 * Click button by text
 * @example cy.clickButton('Add Driver')
 */
Cypress.Commands.add('clickButton', (buttonText) => {
  cy.contains('button', buttonText).click();
});

/**
 * Fill form field
 * @example cy.fillField('Name', 'John Doe')
 */
Cypress.Commands.add('fillField', (label, value) => {
  cy.contains('label', label).parent().find('input, select, textarea').type(value);
});

/**
 * Verify alert or notification
 * @example cy.verifyAlert('Success')
 */
Cypress.Commands.add('verifyAlert', (message) => {
  cy.contains(message).should('be.visible');
});

/**
 * Verify compliance badge status
 * @example cy.verifyBadgeStatus('Active', 'success')
 */
Cypress.Commands.add('verifyBadgeStatus', (text, type) => {
  cy.contains('.badge, .status', text).should('have.class', type);
});

/**
 * Wait for page to be fully loaded
 * @example cy.waitForPageLoad()
 */
Cypress.Commands.add('waitForPageLoad', () => {
  cy.window().should('have.property', 'document');
  cy.document().should('have.property', 'readyState', 'complete');
});

/**
 * Verify API response
 * @example cy.verifyApiResponse('@getDrivers', 200, 'array')
 */
Cypress.Commands.add('verifyApiResponse', (alias, statusCode, dataType) => {
  cy.wait(alias).then((interception) => {
    expect(interception.response.statusCode).to.eq(statusCode);
    if (dataType === 'array') {
      expect(interception.response.body).to.be.an('array');
    } else if (dataType === 'object') {
      expect(interception.response.body).to.be.an('object');
    }
  });
});

/**
 * Intercept API calls
 * @example cy.interceptApi('GET', '/drivers', 'getDrivers')
 */
Cypress.Commands.add('interceptApi', (method, endpoint, alias) => {
  const apiUrl = Cypress.env('apiUrl');
  cy.intercept(method, `${apiUrl}${endpoint}`).as(alias);
});
