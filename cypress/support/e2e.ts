import '@testing-library/cypress/add-commands'

beforeEach(() => {
  cy.intercept({ url: '**/api/transcriber?*' }, (request) => {
    const operation = new URL(request.url).searchParams.get('operation')
    throw new Error(
      `Unexpected transcriber request: ${request.method} ${operation ?? 'unknown'}`,
    )
  })
})
