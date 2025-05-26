import { jest } from '@jest/globals';
import http from 'http';
import { spawn } from 'child_process';
import fetch from 'node-fetch';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Server Integration Tests', () => {
  let serverProcess;
  let serverPort;
  
  beforeAll(async () => {
    // Set test environment variables
    process.env.TEST_TOKEN_NOTION_API_KEY = 'test_notion_key';
    process.env.TEST_TOKEN_FIREFLIES_API_TOKEN = 'test_fireflies_token';
    process.env.DEFAULT_NOTION_API_KEY = 'default_notion_key';
    
    // Find an available port
    serverPort = await getAvailablePort();
    process.env.PORT = serverPort;
    
    // Start the server as a child process
    serverProcess = spawn('node', [path.join(__dirname, '../../server.js')], {
      env: { ...process.env },
      stdio: ['pipe', 'pipe', 'pipe']
    });
    
    // Wait for server to start
    await waitForServer(serverPort);
  }, 30000);
  
  afterAll(async () => {
    if (serverProcess) {
      serverProcess.kill('SIGTERM');
      await new Promise(resolve => {
        serverProcess.on('close', resolve);
      });
    }
  });
  
  describe('SSE Endpoint Tests', () => {
    test('should accept connection with valid token', async () => {
      const response = await fetch(`http://localhost:${serverPort}/mcp/test_token`, {
        headers: {
          'Accept': 'text/event-stream'
        }
      });
      
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('text/event-stream');
      
      // Close the connection
      await response.body.cancel();
    });
    
    test('should reject connection with invalid token', async () => {
      const response = await fetch(`http://localhost:${serverPort}/mcp/invalid_token`, {
        headers: {
          'Accept': 'text/event-stream'
        }
      });
      
      expect(response.status).toBe(403);
      const body = await response.json();
      expect(body.error).toContain('Forbidden');
    });
  });
  
  describe('POST Endpoint Tests', () => {
    test('should return 404 for POST without active session', async () => {
      const response = await fetch(`http://localhost:${serverPort}/mcp/test_token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'test',
          params: {},
          id: 1
        })
      });
      
      expect(response.status).toBe(404);
      const body = await response.json();
      expect(body.error).toContain('Session not found');
    });
  });
});

async function getAvailablePort() {
  return new Promise((resolve) => {
    const server = http.createServer();
    server.listen(0, () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
}

async function waitForServer(port, timeout = 10000) {
  const startTime = Date.now();
  
  while (Date.now() - startTime < timeout) {
    try {
      const response = await fetch(`http://localhost:${port}/mcp/test`);
      if (response.status === 403 || response.status === 200) {
        return true;
      }
    } catch (err) {
      // Server not ready yet
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  
  throw new Error('Server failed to start within timeout');
}