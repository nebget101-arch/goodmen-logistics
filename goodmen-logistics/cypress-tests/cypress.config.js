const { defineConfig } = require('cypress');

module.exports = defineConfig({
  e2e: {
    baseUrl: process.env.CYPRESS_BASE_URL || 'https://safetyapp-ln58.onrender.com',
    apiUrl: (process.env.CYPRESS_BASE_URL || 'https://safetyapp-ln58.onrender.com') + '/api',
    viewportWidth: 1920,
    viewportHeight: 1080,
    defaultCommandTimeout: 10000,
    requestTimeout: 10000,
    responseTimeout: 10000,
    video: true,
    screenshotOnRunFailure: true,
    videoCompression: 32,
    
    setupNodeEvents(on, config) {
      // implement node event listeners here
      on('task', {
        log(message) {
          console.log(message);
          return null;
        },
      });
      return config;
    },

    specPattern: 'cypress/e2e/**/*.cy.{js,jsx,ts,tsx}',
    supportFile: 'cypress/support/e2e.js',
    fixturesFolder: 'cypress/fixtures',
    screenshotsFolder: 'cypress/screenshots',
    videosFolder: 'cypress/videos',
  },

  env: {
    apiUrl: 'http://localhost:3000/api',
    coverage: false,
  },

  retries: {
    runMode: 0,
    openMode: 0,
  },

  watchForFileChanges: true,
});
