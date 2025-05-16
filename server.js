#!/usr/bin/env node

import { Server as McpSDKServer } from "@modelcontextprotocol/sdk/server/index.js";
import express from "express";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { z } from "zod";
import { Client as NotionClient } from "@notionhq/client";
import dotenv from "dotenv";
import { AsyncLocalStorage } from "async_hooks";

dotenv.config();
const als = new AsyncLocalStorage();

// --- User Token to Notion API Key Mapping (Server-Side Secure Storage) ---
// In a real application, this would come from a secure database or vault,
// mapping user tokens (from the URL) to their encrypted Notion API keys.
// For this example, we'll use environment variables based on tokens.
// Example: USERTOKEN1_NOTION_API_KEY=secret_abc...
//          USERTOKEN2_NOTION_API_KEY=secret_xyz...
function getNotionApiKeyForUserToken(userToken) {
  if (!userToken) return null;
  // Example: If userToken is "sjoerd_token", look for SJOERD_TOKEN_NOTION_API_KEY
  const envVarName = `${userToken.toUpperCase()}_NOTION_API_KEY`;
  const apiKey = process.env[envVarName];
  if (apiKey) {
    console.log(`[${userToken}] Found Notion API key in env var: ${envVarName}`);
    return apiKey;
  }
  console.warn(`[${userToken}] No specific Notion API key found in env for token. Falling back to default if available.`);
  return process.env.DEFAULT_NOTION_API_KEY; // A general fallback
}
// ----------------------------------------------------------------------

// Stores { transport: SSEServerTransport, notionApiKey: string | null, userToken: string }
const activeClientSessions = new Map(); // Keyed by userToken from URL

const mcpServer = new McpSDKServer({
  name: "notion-mcp-url-token",
  version: "1.2.0",
}, {
  capabilities: { tools: true },
});

mcpServer.setRequestHandler(z.object({
  method: z.string(),
  params: z.any().optional()
}), async (jsonRpcRequest) => {
  const store = als.getStore();
  const sessionIdForLog = store?.currentSessionId || "unknown_session";
  console.error(`[${sessionIdForLog}] Received raw MCP request method:`, jsonRpcRequest.method);
  // Uncomment for deep debugging:
  // console.error(`[${sessionIdForLog}] Full JSON-RPC Request:`, JSON.stringify(jsonRpcRequest, null, 2));
  return undefined;
}, { priority: -1 });

// --- Handler for the 'initialize' method to capture API Key ---
mcpServer.setRequestHandler(
  z.object({
    method: z.literal("initialize"),
    params: z.object({
      initializationOptions: z.object({
        notionApiKey: z.string().optional(),
      }).passthrough().optional(),
    }).passthrough(),
  }),
  async (jsonRpcRequest) => {
    const store = als.getStore();
    const sessionId = store?.currentSessionId;
    console.error(`[${sessionId || 'initialize'}] MCP 'initialize' handler invoked (ALS).`);

    if (!sessionId) {
      console.error(`[initialize] CRITICAL: Could not get sessionId from AsyncLocalStorage. API key cannot be stored.`);
      return { capabilities: mcpServer.capabilities };
    }

    const sessionData = activeSessions.get(sessionId);

    if (sessionData) {
      const clientProvidedApiKey = jsonRpcRequest.params?.initializationOptions?.notionApiKey;
      if (clientProvidedApiKey) {
        sessionData.notionApiKey = clientProvidedApiKey;
        // No need to set again, it's a reference
        console.error(`[${sessionId}] User-specific Notion API Key stored via initialize.`);
      } else {
        console.error(`[${sessionId}] No Notion API Key found in initializationOptions.`);
      }
    } else {
      console.error(`[${sessionId}] WARNING: Session data not found in activeSessions map during initialize.`);
    }
    return { capabilities: mcpServer.capabilities };
  },
  { priority: 1 }
);

// --- 'tools/list' Handler (Tool schemas are clean) ---
mcpServer.setRequestHandler(z.object({
  method: z.literal("tools/list")
}), async (jsonRpcRequest) => {
  const store = als.getStore();
  const sessionId = store?.currentSessionId;
  console.error(`[${sessionId || 'tools/list'}] MCP 'tools/list' handler invoked (ALS).`);
  // Return the same tools for everyone; access control is per-call via API key
  return {
    tools: [
      // (Paste your tool definitions here, unchanged, but without any notionApiKey in inputSchema)
      // For brevity, you can copy your previous tool definitions here.
      // ... (omitted for brevity, but should be the same as before)
    ]
  };
});

// --- 'tools/call' Handler (Uses API key from session) ---
mcpServer.setRequestHandler(z.object({
  method: z.literal("tools/call"),
  params: z.object({ name: z.string(), arguments: z.any().optional() })
}), async (jsonRpcRequest) => {
  const { name, arguments: args } = jsonRpcRequest.params;
  const store = als.getStore();
  const sessionId = store?.currentSessionId;

  console.error(`[${sessionId || 'tools/call'}] MCP 'tools/call' for tool: ${name} (ALS).`);

  if (!sessionId) {
    console.error(`[${name}] CRITICAL: Could not get sessionId from AsyncLocalStorage for tools/call.`);
    return { isError: true, content: [{ type: "text", text: "Internal Server Error: Session context lost." }] };
  }

  const sessionData = activeSessions.get(sessionId);
  if (!sessionData) {
      console.error(`[${sessionId}] CRITICAL: Session data not found in activeSessions for tools/call.`);
      return { isError: true, content: [{ type: "text", text: "Internal Server Error: Session data missing." }] };
  }

  let userApiKey = sessionData.notionApiKey;
  let effectiveApiKey = userApiKey;

  if (!effectiveApiKey) {
    effectiveApiKey = process.env.NOTION_API_KEY;
    if (effectiveApiKey) {
      console.warn(`[${sessionId}] Tool '${name}': Using server default Notion API Key (no client key in session).`);
    } else {
      console.error(`[${sessionId}] Tool '${name}': CRITICAL: No Notion API Key for session and no server default.`);
      return { isError: true, content: [{ type: "text", text: `Authorization Error: No Notion API Key configured for your session or as server default for tool '${name}'.` }] };
    }
  }

  const notionForUser = new NotionClient({ auth: effectiveApiKey });

  try {
    console.log(`[${sessionId}] Attempting to execute tool '${name}' with effective API key ending: ${effectiveApiKey.slice(-4)}`);

    if (name === "list-databases") {
      console.log(`[${sessionId}] Executing 'list-databases' for user.`);
      const response = await notionForUser.search({
        filter: { property: "object", value: "database" },
        page_size: 100,
        sort: { direction: "descending", timestamp: "last_edited_time" }
      });
      console.log(`[${sessionId}] 'list-databases' successful. Found ${response.results.length} databases.`);
      return { content: [{ type: "text", text: JSON.stringify(response.results, null, 2) }] };
    }
    else if (name === "query-database") {
      const { database_id, filter, sorts, start_cursor, page_size } = args || {};
      if (!database_id) {
        console.error(`[${sessionId}] 'query-database' missing database_id.`);
        return { isError: true, content: [{ type: "text", text: "Error: database_id is required for query-database."}] };
      }
      console.log(`[${sessionId}] Executing 'query-database' for user on DB: ${database_id}.`);
      const queryParams = { database_id, page_size: page_size || 100, filter, sorts, start_cursor };
      Object.keys(queryParams).forEach(key => queryParams[key] === undefined && delete queryParams[key]);
      const response = await notionForUser.databases.query(queryParams);
      console.log(`[${sessionId}] 'query-database' successful. Found ${response.results.length} items.`);
      return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }] };
    }
    else if (name === "create-page") {
      const { parent_id, properties, children } = args || {};
      const pageParams = { parent: { database_id: parent_id }, properties };
      if (children) pageParams.children = children;
      console.log(`[${sessionId}] Executing 'create-page' for user.`);
      const response = await notionForUser.pages.create(pageParams);
      console.log(`[${sessionId}] 'create-page' successful. Page created with id: ${response.id}`);
      return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }] };
    }
    else if (name === "update-page") {
      const { page_id, properties, archived } = args || {};
      const updateParams = { page_id, properties };
      if (archived !== undefined) updateParams.archived = archived;
      console.log(`[${sessionId}] Executing 'update-page' for user.`);
      const response = await notionForUser.pages.update(updateParams);
      console.log(`[${sessionId}] 'update-page' successful. Page updated with id: ${response.id}`);
      return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }] };
    }
    else if (name === "create-database") {
      let { parent_id, title, properties, icon, cover } = args || {};
      parent_id = parent_id.replace(/-/g, "");
      const databaseParams = { parent: { type: "page_id", page_id: parent_id }, title, properties };
      if (icon && icon.type === "emoji" && !icon.emoji) {
        icon.emoji = "📄";
        databaseParams.icon = icon;
      } else if (icon) {
        databaseParams.icon = icon;
      }
      if (cover) databaseParams.cover = cover;
      console.log(`[${sessionId}] Executing 'create-database' for user.`);
      const response = await notionForUser.databases.create(databaseParams);
      console.log(`[${sessionId}] 'create-database' successful. Database created with id: ${response.id}`);
      return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }] };
    }
    else if (name === "update-database") {
      const { database_id, title, description, properties } = args || {};
      const updateParams = { database_id };
      if (title !== undefined) updateParams.title = title;
      if (description !== undefined) updateParams.description = description;
      if (properties !== undefined) updateParams.properties = properties;
      console.log(`[${sessionId}] Executing 'update-database' for user.`);
      const response = await notionForUser.databases.update(updateParams);
      console.log(`[${sessionId}] 'update-database' successful. Database updated with id: ${response.id}`);
      return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }] };
    }
    else if (name === "get-page") {
      let { page_id } = args || {};
      page_id = page_id.replace(/-/g, "");
      console.log(`[${sessionId}] Executing 'get-page' for user.`);
      const response = await notionForUser.pages.retrieve({ page_id });
      console.log(`[${sessionId}] 'get-page' successful. Page id: ${response.id}`);
      return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }] };
    }
    else if (name === "get-block-children") {
      let { block_id, start_cursor, page_size } = args || {};
      block_id = block_id.replace(/-/g, "");
      const params = { block_id, page_size: page_size || 100 };
      if (start_cursor) params.start_cursor = start_cursor;
      console.log(`[${sessionId}] Executing 'get-block-children' for user.`);
      const response = await notionForUser.blocks.children.list(params);
      console.log(`[${sessionId}] 'get-block-children' successful. Found ${response.results.length} children.`);
      return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }] };
    }
    else if (name === "append-block-children") {
      let { block_id, children, after } = args || {};
      block_id = block_id.replace(/-/g, "");
      const params = { block_id, children };
      if (after) params.after = after.replace(/-/g, "");
      console.log(`[${sessionId}] Executing 'append-block-children' for user.`);
      const response = await notionForUser.blocks.children.append(params);
      console.log(`[${sessionId}] 'append-block-children' successful.`);
      return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }] };
    }
    else if (name === "update-block") {
      let { block_id, block_type, content, archived } = args || {};
      block_id = block_id.replace(/-/g, "");
      const updateParams = { block_id, [block_type]: content };
      if (archived !== undefined) updateParams.archived = archived;
      console.log(`[${sessionId}] Executing 'update-block' for user.`);
      const response = await notionForUser.blocks.update(updateParams);
      console.log(`[${sessionId}] 'update-block' successful. Block updated with id: ${response.id}`);
      return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }] };
    }
    else if (name === "get-block") {
      let { block_id } = args || {};
      block_id = block_id.replace(/-/g, "");
      console.log(`[${sessionId}] Executing 'get-block' for user.`);
      const response = await notionForUser.blocks.retrieve({ block_id });
      console.log(`[${sessionId}] 'get-block' successful. Block id: ${response.id}`);
      return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }] };
    }
    else if (name === "search") {
      const { query, filter, sort, start_cursor, page_size } = args || {};
      const searchParams = { query: query || "", page_size: page_size || 100 };
      if (filter) searchParams.filter = filter;
      if (sort) searchParams.sort = sort;
      if (start_cursor) searchParams.start_cursor = start_cursor;
      console.log(`[${sessionId}] Executing 'search' for user.`);
      const response = await notionForUser.search(searchParams);
      console.log(`[${sessionId}] 'search' successful. Found ${response.results.length} results.`);
      return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }] };
    }
    else {
      console.error(`[${sessionId}] Unknown tool called: ${name}`);
      return { isError: true, content: [{ type: "text", text: `Unknown tool: ${name}` }] };
    }
  } catch (error) {
    console.error(`[${sessionId}] Error executing tool '${name}': Code: ${error.code}, Message: ${error.message}`);
    let errorMessage = `Error executing tool '${name}': ${error.message}`;
    if (error.code === 'unauthorized' || (error.body && typeof error.body === 'string' && error.body.includes('unauthorized')) || (error.body && typeof error.body === 'object' && error.body.code === 'unauthorized')) {
        errorMessage = `Notion API Error for '${name}': Authorization failed. The API Key for your session (ending with ${effectiveApiKey.slice(-4)}) may be invalid or lack necessary permissions.`;
    }
    return { isError: true, content: [{ type: "text", text: errorMessage }] };
  }
});

// --- Express App Setup ---
const app = express();

// SSE Connection Endpoint - path now includes :userToken
app.get("/mcp/:userToken", (req, res) => {
  const userToken = req.params.userToken;
  console.error(`[${userToken}] GET /mcp/${userToken}: New client connection.`);

  const userNotionApiKey = getNotionApiKeyForUserToken(userToken);
  if (!userNotionApiKey) {
    console.error(`[${userToken}] Unauthorized: No Notion API Key configured for this token.`);
    return res.status(403).json({ error: "Forbidden: Invalid user token or API key not configured." });
  }

  // For SSEServerTransport, the `messagesPath` is where the client should POST.
  // If the client POSTs to the same unique URL, make messagesPath unique too.
  // Or, if client always POSTs to a generic /mcp, we have a problem.
  // Let's assume client POSTs to /mcp/:userToken
  const messagesPathForClient = `/mcp/${userToken}`;
  const clientTransport = new SSEServerTransport(messagesPathForClient, res);

  activeClientSessions.set(userToken, {
    transport: clientTransport,
    notionApiKey: userNotionApiKey, // Store the resolved API key
    userToken: userToken
  });
  console.error(`[${userToken}] Session created with Notion API key. Total active: ${activeClientSessions.size}`);

  res.on('close', () => {
    console.error(`[${userToken}] GET /mcp/${userToken}: SSE connection closed by client.`);
    activeClientSessions.delete(userToken);
    console.error(`[${userToken}] Session removed. Total active: ${activeClientSessions.size}`);
  });

  // Run mcpServer.connect within an ALS context for this userToken
  als.run({ currentUserToken: userToken, currentTransport: clientTransport }, () => {
    mcpServer.connect(clientTransport)
      .then(() => console.error(`[${userToken}] MCP Server connected to transport.`))
      .catch(err => {
        console.error(`[${userToken}] MCP handshake error:`, err);
        activeClientSessions.delete(userToken);
        if (!res.headersSent) res.status(500).send("MCP connection error");
        else if (!res.writableEnded) res.end();
      });
  });
  // NO EXPLICIT res.write for session ID here; session is identified by URL token.
});

// Message POST Endpoint - path now includes :userToken
app.post("/mcp/:userToken", (req, res) => {
  const userToken = req.params.userToken;
  console.error(`[${userToken}] POST /mcp/${userToken}. Headers:`, JSON.stringify(req.headers, null, 2));

  const session = activeClientSessions.get(userToken);
  if (session && session.transport) {
    console.error(`[${userToken}] Routing message to transport for token. Setting ALS context.`);
    als.run({ currentUserToken: userToken, currentTransport: session.transport }, () => {
      try {
        session.transport.handlePostMessage(req, res);
      } catch (e) {
        console.error(`[${userToken}] Error during handlePostMessage or subsequent processing:`, e);
        if (!res.headersSent) {
          res.status(500).json({ error: "Internal server error processing message."});
        } else if (!res.writableEnded) {
          res.end(); // Try to close if possible
        }
      }
    });
  } else {
    console.error(`[${userToken}] No active session/transport found for token.`);
    res.status(404).json({ error: "Session not found for this user token." });
  }
});

const PORT = process.env.PORT || 8787;
app.listen(PORT, "0.0.0.0", () => {
  console.error(`Notion MCP Server listening. Base URL: http://0.0.0.0:${PORT}/mcp/:userToken`);
});
