# Tests for Notion MCP Server

This directory contains the test suite for the Notion MCP Server.

## Test Structure

```
tests/
├── __tests__/
│   ├── api-keys.test.js      # Tests for API key retrieval functions
│   ├── express-endpoints.test.js  # Tests for Express endpoints
│   ├── server-integration.test.js # Integration tests for the server
│   └── tools.test.js          # Tests for Notion and Fireflies tools
└── README.md
```

## Running Tests

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage
npm run test:coverage
```

## Test Files

### api-keys.test.js
Tests for the `getNotionApiKeyForUserToken` and `getFirefliesApiTokenForUserToken` functions:
- Token-based API key retrieval
- Default fallback behavior
- Null/undefined handling
- Case conversion

### tools.test.js
Tests for Notion and Fireflies tool implementations:
- All Notion API operations (list-databases, query-database, create-page, etc.)
- Fireflies transcript operations
- Error handling and authorization
- Output formatting and truncation

### server-integration.test.js
Integration tests for the Express server:
- SSE endpoint connection handling
- Authentication and authorization
- Session management
- Error scenarios

### express-endpoints.test.js
Unit tests for Express endpoints:
- GET /mcp/:userToken (SSE connection)
- POST /mcp/:userToken (message handling)
- Session lifecycle management

## Test Environment

Tests use Jest with ES modules support. Key features:
- Mocking of external dependencies (Notion API, Fireflies API)
- Console output suppression during tests
- Environment variable isolation
- Async/await support

## Adding New Tests

When adding new functionality, ensure to:
1. Add unit tests for individual functions
2. Add integration tests for API endpoints
3. Mock external dependencies appropriately
4. Test both success and error scenarios
5. Maintain test coverage above 80%