import { jest } from '@jest/globals';
import request from 'supertest';
import express from 'express';

describe('Express Endpoints', () => {
  let app;
  let mockSSEServerTransport;
  let mockMcpServer;
  let consoleErrorSpy;

  beforeEach(() => {
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
    jest.spyOn(console, 'log').mockImplementation();
    jest.spyOn(console, 'warn').mockImplementation();

    // Mock environment variables
    process.env.SJOERD_URL_TOKEN_NOTION_API_KEY = 'test_notion_key';
    process.env.SJOERD_URL_TOKEN_FIREFLIES_API_TOKEN = 'test_fireflies_token';
    process.env.DEFAULT_NOTION_API_KEY = 'default_notion_key';

    // Create a fresh Express app for each test
    app = express();
    app.use(express.json());

    // Mock SSEServerTransport
    mockSSEServerTransport = jest.fn().mockImplementation((path, res) => ({
      handlePostMessage: jest.fn()
    }));

    // Mock MCP Server
    mockMcpServer = {
      connect: jest.fn().mockResolvedValue(undefined),
      setRequestHandler: jest.fn()
    };

    // Mock imports
    jest.unstable_mockModule('@modelcontextprotocol/sdk/server/sse.js', () => ({
      SSEServerTransport: mockSSEServerTransport
    }));

    jest.unstable_mockModule('@modelcontextprotocol/sdk/server/index.js', () => ({
      Server: jest.fn().mockImplementation(() => mockMcpServer)
    }));
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
    consoleErrorSpy.mockRestore();
  });

  describe('GET /mcp/:userToken', () => {
    test('should establish SSE connection with valid Notion API key', async () => {
      const setupEndpoints = (await import('../../server.js')).setupExpressEndpoints;
      setupEndpoints(app);

      const response = await request(app)
        .get('/mcp/sjoerd_url_token')
        .expect(200);

      expect(mockSSEServerTransport).toHaveBeenCalledWith('/mcp/sjoerd_url_token', expect.any(Object));
      expect(mockMcpServer.connect).toHaveBeenCalled();
    });

    test('should establish SSE connection with valid Fireflies API token only', async () => {
      delete process.env.SJOERD_URL_TOKEN_NOTION_API_KEY;
      process.env.SJOERD_URL_TOKEN_FIREFLIES_API_TOKEN = 'test_fireflies_token';

      const setupEndpoints = (await import('../../server.js')).setupExpressEndpoints;
      setupEndpoints(app);

      const response = await request(app)
        .get('/mcp/sjoerd_url_token')
        .expect(200);

      expect(mockSSEServerTransport).toHaveBeenCalledWith('/mcp/sjoerd_url_token', expect.any(Object));
    });

    test('should return 403 when no API keys configured for token', async () => {
      delete process.env.UNKNOWN_TOKEN_NOTION_API_KEY;
      delete process.env.UNKNOWN_TOKEN_FIREFLIES_API_TOKEN;
      delete process.env.DEFAULT_NOTION_API_KEY;
      delete process.env.DEFAULT_FIREFLIES_API_TOKEN;

      const setupEndpoints = (await import('../../server.js')).setupExpressEndpoints;
      setupEndpoints(app);

      const response = await request(app)
        .get('/mcp/unknown_token')
        .expect(403);

      expect(response.body).toEqual({
        error: "Forbidden: Invalid user token or no API keys configured."
      });
    });

    test('should handle connection close event', async () => {
      const setupEndpoints = (await import('../../server.js')).setupExpressEndpoints;
      const { activeClientSessions } = await import('../../server.js');
      setupEndpoints(app);

      let closeCallback;
      const mockRes = {
        on: jest.fn((event, callback) => {
          if (event === 'close') closeCallback = callback;
        }),
        setHeader: jest.fn(),
        write: jest.fn(),
        end: jest.fn()
      };

      app.get('/mcp/:userToken', (req, res) => {
        Object.assign(res, mockRes);
        // Simulate the endpoint logic
        res.on('close', closeCallback);
      });

      await request(app).get('/mcp/sjoerd_url_token');

      // Simulate connection close
      if (closeCallback) closeCallback();

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('SSE connection closed by client')
      );
    });
  });

  describe('POST /mcp/:userToken', () => {
    test('should route message to correct transport', async () => {
      const setupEndpoints = (await import('../../server.js')).setupExpressEndpoints;
      const { activeClientSessions } = await import('../../server.js');
      setupEndpoints(app);

      // Setup a mock session
      const mockTransport = {
        handlePostMessage: jest.fn()
      };
      activeClientSessions.set('sjoerd_url_token', {
        transport: mockTransport,
        notionApiKey: 'test_key',
        userToken: 'sjoerd_url_token'
      });

      await request(app)
        .post('/mcp/sjoerd_url_token')
        .send({ method: 'test', params: {} })
        .expect(200);

      expect(mockTransport.handlePostMessage).toHaveBeenCalled();
    });

    test('should return 404 when no active session found', async () => {
      const setupEndpoints = (await import('../../server.js')).setupExpressEndpoints;
      setupEndpoints(app);

      const response = await request(app)
        .post('/mcp/unknown_token')
        .send({ method: 'test', params: {} })
        .expect(404);

      expect(response.body).toEqual({
        error: "Session not found for this user token."
      });
    });

    test('should handle errors during message processing', async () => {
      const setupEndpoints = (await import('../../server.js')).setupExpressEndpoints;
      const { activeClientSessions } = await import('../../server.js');
      setupEndpoints(app);

      // Setup a mock session with failing transport
      const mockTransport = {
        handlePostMessage: jest.fn().mockImplementation(() => {
          throw new Error('Transport error');
        })
      };
      activeClientSessions.set('sjoerd_url_token', {
        transport: mockTransport,
        notionApiKey: 'test_key',
        userToken: 'sjoerd_url_token'
      });

      const response = await request(app)
        .post('/mcp/sjoerd_url_token')
        .send({ method: 'test', params: {} })
        .expect(500);

      expect(response.body).toEqual({
        error: "Internal server error processing message."
      });
    });
  });
});