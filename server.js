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

// --- Generic Request Logger ---
mcpServer.setRequestHandler(z.object({
  method: z.string(),
  params: z.any().optional()
}), async (jsonRpcRequest) => {
  const store = als.getStore();
  const userToken = store?.currentUserToken || "unknown_user_token";
  console.error(`[${userToken}] MCP Method: ${jsonRpcRequest.method}`);
  return undefined;
}, { priority: -1 });

// --- 'initialize' Handler (No longer needs to get API key from options) ---
mcpServer.setRequestHandler(
  z.object({ method: z.literal("initialize"), params: z.any().optional() }),
  async (jsonRpcRequest) => {
    const store = als.getStore();
    const userToken = store?.currentUserToken;
    console.error(`[${userToken || 'initialize'}] MCP 'initialize' (URL token).`);

    // Optionally log if client sends a notionApiKey in initializationOptions
    const clientProvidedApiKeyInInitOptions = jsonRpcRequest.params?.initializationOptions?.notionApiKey;
    if (clientProvidedApiKeyInInitOptions) {
      console.warn(`[${userToken || 'initialize'}] Client sent 'notionApiKey' in initializationOptions. This is noted, but server uses key derived from URL token ('${userToken}').`);
    }

    // Return the full InitializeResult object as required by MCP spec and Python SDK
    return {
      protocolVersion: "2024-11-05",
      serverInfo: {
        name: mcpServer.serverInfo.name,
        version: mcpServer.serverInfo.version
      },
      capabilities: mcpServer.capabilities
    };
  }, { priority: 1 }
);

// --- 'tools/list' Handler ---
mcpServer.setRequestHandler(z.object({ method: z.literal("tools/list") }),
  async (jsonRpcRequest) => {
    const store = als.getStore();
    const userToken = store?.currentUserToken;
    console.error(`[${userToken || 'tools/list'}] MCP 'tools/list' (URL token).`);
    return {
      tools: [
        { name: "list-databases", description: "List all databases in the user's Notion workspace.", inputSchema: {type: "object", properties: {}} },
        { name: "query-database", description: "Query a Notion database by ID.", inputSchema: {type: "object", properties: { database_id: { type: "string" }, filter: { type: "object" }, sorts: { type: "array" }, start_cursor: { type: "string" }, page_size: { type: "number" }}} },
        { name: "create-page", description: "Create a new page in a Notion database.", inputSchema: {type: "object", properties: { parent_id: { type: "string" }, properties: { type: "object" }, children: { type: "array" }}} },
        { name: "update-page", description: "Update a Notion page by ID.", inputSchema: {type: "object", properties: { page_id: { type: "string" }, properties: { type: "object" }, archived: { type: "boolean" }}} },
        { name: "create-database", description: "Create a new Notion database.", inputSchema: {type: "object", properties: { parent_id: { type: "string" }, title: { type: "array" }, properties: { type: "object" }, icon: { type: "object" }, cover: { type: "object" }}} },
        { name: "update-database", description: "Update a Notion database by ID.", inputSchema: {type: "object", properties: { database_id: { type: "string" }, title: { type: "array" }, description: { type: "array" }, properties: { type: "object" }}} },
        { name: "get-page", description: "Retrieve a Notion page by ID.", inputSchema: {type: "object", properties: { page_id: { type: "string" }}} },
        { name: "get-block-children", description: "List children of a Notion block.", inputSchema: {type: "object", properties: { block_id: { type: "string" }, start_cursor: { type: "string" }, page_size: { type: "number" }}} },
        { name: "append-block-children", description: "Append children to a Notion block.", inputSchema: {type: "object", properties: { block_id: { type: "string" }, children: { type: "array" }, after: { type: "string" }}} },
        { name: "update-block", description: "Update a Notion block by ID.", inputSchema: {type: "object", properties: { block_id: { type: "string" }, block_type: { type: "string" }, content: { type: "object" }, archived: { type: "boolean" }}} },
        { name: "get-block", description: "Retrieve a Notion block by ID.", inputSchema: {type: "object", properties: { block_id: { type: "string" }}} },
        { name: "search", description: "Search the user's Notion workspace.", inputSchema: {type: "object", properties: { query: { type: "string" }, filter: { type: "object" }, sort: { type: "object" }, start_cursor: { type: "string" }, page_size: { type: "number" }}} }
      ]
    };
});

// --- 'tools/call' Handler ---
mcpServer.setRequestHandler(z.object({
  method: z.literal("tools/call"),
  params: z.object({ name: z.string(), arguments: z.any().optional() })
}), async (jsonRpcRequest) => {
  const { name, arguments: args } = jsonRpcRequest.params;
  const store = als.getStore();
  const userToken = store?.currentUserToken;

  console.error(`[${userToken || 'tools/call'}] MCP 'tools/call' for tool: ${name} (URL token).`);

  if (!userToken) {
    console.error(`[${name}] CRITICAL: Could not get userToken from AsyncLocalStorage for tools/call.`);
    return { isError: true, content: [{ type: "text", text: "Internal Server Error: User token context lost." }] };
  }

  const sessionData = activeClientSessions.get(userToken);
  if (!sessionData || !sessionData.notionApiKey) {
    console.error(`[${userToken}] Tool '${name}': No Notion API Key found for this user token in session or default.`);
    return { isError: true, content: [{ type: "text", text: `Authorization Error: Notion API Key not configured for your session token.` }] };
  }

  const notionForUser = new NotionClient({ auth: sessionData.notionApiKey });
  console.log(`[${userToken}] Using API Key ending '...${sessionData.notionApiKey.slice(-4)}' for tool '${name}'.`);

  try {
    if (name === "list-databases") {
      const response = await notionForUser.search({ filter: { property: "object", value: "database" }, page_size: 100, sort: { direction: "descending", timestamp: "last_edited_time" } });
      return { content: [{ type: "text", text: JSON.stringify(response.results, null, 2) }] };
    }
    else if (name === "query-database") {
      const { database_id, filter, sorts, start_cursor, page_size } = args || {};
      if (!database_id) {
        return { isError: true, content: [{ type: "text", text: "Error: database_id is required for query-database."}] };
      }
      const queryParams = { database_id, page_size: page_size || 100, filter, sorts, start_cursor };
      Object.keys(queryParams).forEach(key => queryParams[key] === undefined && delete queryParams[key]);
      const response = await notionForUser.databases.query(queryParams);
      return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }] };
    }
    else if (name === "create-page") {
      const { parent_id, properties, children } = args || {};
      const pageParams = { parent: { database_id: parent_id }, properties };
      if (children) pageParams.children = children;
      const response = await notionForUser.pages.create(pageParams);
      return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }] };
    }
    else if (name === "update-page") {
      const { page_id, properties, archived } = args || {};
      const updateParams = { page_id, properties };
      if (archived !== undefined) updateParams.archived = archived;
      const response = await notionForUser.pages.update(updateParams);
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
      const response = await notionForUser.databases.create(databaseParams);
      return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }] };
    }
    else if (name === "update-database") {
      const { database_id, title, description, properties } = args || {};
      const updateParams = { database_id };
      if (title !== undefined) updateParams.title = title;
      if (description !== undefined) updateParams.description = description;
      if (properties !== undefined) updateParams.properties = properties;
      const response = await notionForUser.databases.update(updateParams);
      return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }] };
    }
    else if (name === "get-page") {
      let { page_id } = args || {};
      page_id = page_id.replace(/-/g, "");
      const response = await notionForUser.pages.retrieve({ page_id });
      return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }] };
    }
    else if (name === "get-block-children") {
      let { block_id, start_cursor, page_size } = args || {};
      block_id = block_id.replace(/-/g, "");
      const params = { block_id, page_size: page_size || 100 };
      if (start_cursor) params.start_cursor = start_cursor;
      const response = await notionForUser.blocks.children.list(params);
      return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }] };
    }
    else if (name === "append-block-children") {
      let { block_id, children, after } = args || {};
      block_id = block_id.replace(/-/g, "");
      const params = { block_id, children };
      if (after) params.after = after.replace(/-/g, "");
      const response = await notionForUser.blocks.children.append(params);
      return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }] };
    }
    else if (name === "update-block") {
      let { block_id, block_type, content, archived } = args || {};
      block_id = block_id.replace(/-/g, "");
      const updateParams = { block_id, [block_type]: content };
      if (archived !== undefined) updateParams.archived = archived;
      const response = await notionForUser.blocks.update(updateParams);
      return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }] };
    }
    else if (name === "get-block") {
      let { block_id } = args || {};
      block_id = block_id.replace(/-/g, "");
      const response = await notionForUser.blocks.retrieve({ block_id });
      return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }] };
    }
    else if (name === "search") {
      const { query, filter, sort, start_cursor, page_size } = args || {};
      const searchParams = { query: query || "", page_size: page_size || 100 };
      if (filter) searchParams.filter = filter;
      if (sort) searchParams.sort = sort;
      if (start_cursor) searchParams.start_cursor = start_cursor;
      const response = await notionForUser.search(searchParams);
      return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }] };
    }
    else {
      return { isError: true, content: [{ type: "text", text: `Unknown tool: ${name}` }] };
    }
  } catch (error) {
    let errorMessage = `Error executing tool '${name}': ${error.message}`;
    if (error.code === 'unauthorized' || (error.body && typeof error.body === 'string' && error.body.includes('unauthorized')) || (error.body && typeof error.body === 'object' && error.body.code === 'unauthorized')) {
        errorMessage = `Notion API Error for '${name}': Authorization failed. The API Key for your session (ending with ${sessionData.notionApiKey.slice(-4)}) may be invalid or lack necessary permissions.`;
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
      .then(() => {
        console.error(`[${userToken}] MCP Server connected to transport.`);
        // No custom mcp-session-id event is sent; session is identified by URL token.
      })
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
