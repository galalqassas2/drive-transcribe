const { defineConfig } = require('cypress')

module.exports = defineConfig({
  video: false,
  screenshotOnRunFailure: false,
  e2e: {
    baseUrl: 'http://127.0.0.1:5173',
    specPattern: 'cypress/e2e/**/*.cy.ts',
    supportFile: 'cypress/support/e2e.ts',
  },
})
