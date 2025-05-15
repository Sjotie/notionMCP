#!/usr/bin/env node

import { Server as McpSDKServer } from "@modelcontextprotocol/sdk/server/index.js";
import express from "express";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { z } from "zod";
import { Client as NotionClient } from "@notionhq/client";
import dotenv from "dotenv";
import { v4 as uuidv4 } from "uuid";
import { AsyncLocalStorage } from "async_hooks";

// Load environment variables
dotenv.config();

const als = new AsyncLocalStorage();

// --- Session Management ---
// Stores { transport: SSEServerTransport, notionApiKey: string | null }
const activeSessions = new Map(); // Map<sessionId, SessionData>
// --------------------------

 // Create MCP server instance
const mcpServer = new McpSDKServer({
  name: "notion-mcp-multiuser",
  version: "1.1.0",
}, {
  capabilities: {
    tools: true // Indicate that the server supports tools
  },
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

app.get("/mcp", (req, res) => {
  const sessionId = uuidv4();
  console.error(`[${sessionId}] GET /mcp: New client connection. Assigning sessionId.`);

  // SSEServerTransport will set the necessary SSE headers on 'res' when it starts.
  const clientTransport = new SSEServerTransport("/mcp", res);
  clientTransport._customSessionId = sessionId;

  activeSessions.set(sessionId, { transport: clientTransport, notionApiKey: null });
  console.error(`[${sessionId}] Session created. Total active: ${activeSessions.size}`);

  res.on('close', () => {
    console.error(`[${sessionId}] GET /mcp: SSE connection closed by client.`);
    const session = activeSessions.get(sessionId);
    // Optional: If SDK provided a specific disconnect for transport, call it.
    // if (session && typeof session.transport?.close === 'function') {
    //   session.transport.close();
    // }
    activeSessions.delete(sessionId);
    console.error(`[${sessionId}] Session removed. Total active: ${activeSessions.size}`);
    // If mcpServer had a disconnect method:
    // mcpServer.disconnect(clientTransport);
  });

  mcpServer.connect(clientTransport)
    .then(() => {
      console.error(`[${sessionId}] MCP Server connected to transport. SSE stream initialized by transport.`);
      // Now that the transport has set its headers and the stream is ready,
      // send your custom session ID event.
      // Ensure the response object 'res' is still valid and the stream is open.
      if (!res.writableEnded) {
        res.write(`event: mcp-session-id\ndata: ${JSON.stringify({ sessionId })}\n\n`);
        console.error(`[${sessionId}] Sent mcp-session-id event to client over established stream.`);
      } else {
        console.error(`[${sessionId}] WARNING: SSE stream was already ended before mcp-session-id event could be sent.`);
      }
    })
    .catch(err => {
      console.error(`[${sessionId}] MCP handshake error or error during connect:`, err);
      // If connect fails, the session might not be fully usable or established.
      // It's already removed from activeSessions in the 'close' event if that triggers,
      // but if 'close' doesn't trigger before this catch, ensure cleanup.
      if (activeSessions.has(sessionId)) {
          activeSessions.delete(sessionId);
          console.error(`[${sessionId}] Session removed due to connection error. Total active: ${activeSessions.size}`);
      }
      // Avoid trying to write to res if headers might have been an issue
      if (!res.headersSent) {
        res.status(500).send("MCP connection error");
      } else if (!res.writableEnded) {
        // If headers were sent but stream is open, try to close it gracefully if possible
        res.end();
      }
    });
});

app.post("/mcp", (req, res) => {
  // Debug: log all incoming headers for troubleshooting content-type issues
  console.error("POST /mcp received. Headers:", JSON.stringify(req.headers, null, 2)); 

  const sessionId = req.header("X-MCP-Session-ID");
  if (!sessionId) {
    console.error("POST /mcp: Missing X-MCP-Session-ID header.");
    return res.status(400).json({ error: "X-MCP-Session-ID header is required." });
  }
  const session = activeSessions.get(sessionId);
  if (session && session.transport) {
    console.error(`[${sessionId}] POST /mcp: Routing message to transport. Setting ALS context.`);
    als.run({ currentSessionId: sessionId, currentTransport: session.transport }, () => {
      try {
        session.transport.handlePostMessage(req, res);
      } catch (e) {
        console.error(`[${sessionId}] Error during handlePostMessage or subsequent processing:`, e);
        if (!res.headersSent) {
          res.status(500).json({ error: "Internal server error processing message."});
        } else if (!res.writableEnded) {
          res.end(); // Try to close if possible
        }
      }
    });
  } else {
    console.error(`[${sessionId || 'unknown'}] POST /mcp: No active session/transport found for session ID.`);
    res.status(404).json({ error: "Session not found or transport unavailable. Re-establish SSE connection." });
  }
});

const PORT = process.env.PORT || 8787;
app.listen(PORT, "127.0.0.1", () => {
  console.error(`Notion MCP Server listening on http://127.0.0.1:${PORT}/mcp`);
});
