// ***********************************************************
// This support file is processed and loaded automatically before test files.
// This is a great place to put global configuration and behavior that modifies Cypress.
// ***********************************************************

import './commands';

// Hide fetch/XHR requests from command log for cleaner output
const app = window.top;
if (!app.document.head.querySelector('[data-hide-command-log-request]')) {
  const style = app.document.createElement('style');
  style.innerHTML = '.command-name-request, .command-name-xhr { display: none }';
  style.setAttribute('data-hide-command-log-request', '');
  app.document.head.appendChild(style);
}

// Global after hook
afterEach(function() {
  // Take screenshot on failure
  if (this.currentTest.state === 'failed') {
    cy.screenshot(`${this.currentTest.parent.title} -- ${this.currentTest.title}`);
  }
});

// Handle uncaught exceptions
Cypress.on('uncaught:exception', (err, runnable) => {
  // Return false to prevent Cypress from failing the test
  console.error('Uncaught exception:', err);
  return false;
});
