#!/usr/bin/env node

import { Server as McpSDKServer } from "@modelcontextprotocol/sdk/server/index.js";
import express from "express";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { z } from "zod";
import { Client as NotionClient } from "@notionhq/client";
import dotenv from "dotenv";
import { v4 as uuidv4 } from "uuid";

// Load environment variables
dotenv.config();

// --- Session Management ---
// Stores { transport: SSEServerTransport, notionApiKey: string | null }
const activeSessions = new Map(); // Map<sessionId, SessionData>
// --------------------------

// Create MCP server instance
const mcpServer = new McpSDKServer({
  name: "notion-mcp-multiuser",
  version: "1.1.0",
}, {
  capabilities: {},
});

mcpServer.setRequestHandler(z.object({
  method: z.string(),
  params: z.any().optional()
}), async (request, executionContext) => {
  const sessionId = executionContext?.transport?._customSessionId || "unknown_session";
  console.error(`[${sessionId}] Received raw MCP request:`, JSON.stringify(request.method, null, 2));
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
  async (request, executionContext) => {
    const transport = executionContext?.transport;
    const sessionId = transport?._customSessionId;
    console.error(`[${sessionId || 'initialize'}] MCP 'initialize' handler invoked.`);

    if (!transport || !sessionId) {
      console.error(`[initialize] CRITICAL: Could not identify client session/transport from executionContext. API key cannot be stored.`);
      return { capabilities: mcpServer.capabilities };
    }

    const clientProvidedApiKey = request.params?.initializationOptions?.notionApiKey;
    const sessionData = activeSessions.get(sessionId);

    if (sessionData) {
      if (clientProvidedApiKey) {
        sessionData.notionApiKey = clientProvidedApiKey;
        activeSessions.set(sessionId, sessionData);
        console.error(`[${sessionId}] User-specific Notion API Key stored via initialize.`);
      } else {
        console.error(`[${sessionId}] No Notion API Key found in initializationOptions. Session will use server default if tool is called.`);
      }
    } else {
      console.error(`[${sessionId}] WARNING: Session data not found for transport during initialize. This shouldn't happen.`);
    }
    return { capabilities: mcpServer.capabilities };
  },
  { priority: 1 }
);

// --- 'tools/list' Handler (Tool schemas are clean) ---
mcpServer.setRequestHandler(z.object({
  method: z.literal("tools/list")
}), async (request, executionContext) => {
  const sessionId = executionContext?.transport?._customSessionId || "tools/list";
  console.error(`[${sessionId}] MCP 'tools/list' handler invoked.`);
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
}), async (request, executionContext) => {
  const { name, arguments: args } = request.params;
  const transport = executionContext?.transport;
  const sessionId = transport?._customSessionId;

  console.error(`[${sessionId || 'tools/call'}] MCP 'tools/call' for tool: ${name}`);

  if (!transport || !sessionId) {
    console.error(`[${name}] CRITICAL: Could not identify client session/transport. Cannot proceed.`);
    return { isError: true, content: [{ type: "text", text: "Internal Server Error: Could not identify client session." }] };
  }

  const sessionData = activeSessions.get(sessionId);
  let userApiKey = sessionData?.notionApiKey;
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
    // --- Your tool logic using `notionForUser` and `args` ---
    // Example:
    if (name === "list-databases") {
      const response = await notionForUser.search({ filter: { property: "object", value: "database" }, page_size: 100, sort: { direction: "descending", timestamp: "last_edited_time" } });
      return { content: [{ type: "text", text: JSON.stringify(response.results, null, 2) }] };
    }
    else if (name === "query-database") {
      const { database_id, filter, sorts, start_cursor, page_size } = args;
      const queryParams = { database_id, page_size: page_size || 100 };
      if (filter) queryParams.filter = filter;
      if (sorts) queryParams.sorts = sorts;
      if (start_cursor) queryParams.start_cursor = start_cursor;
      const response = await notionForUser.databases.query(queryParams);
      return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }] };
    }
    else if (name === "create-page") {
      const { parent_id, properties, children } = args;
      const pageParams = { parent: { database_id: parent_id }, properties };
      if (children) pageParams.children = children;
      const response = await notionForUser.pages.create(pageParams);
      return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }] };
    }
    else if (name === "update-page") {
      const { page_id, properties, archived } = args;
      const updateParams = { page_id, properties };
      if (archived !== undefined) updateParams.archived = archived;
      const response = await notionForUser.pages.update(updateParams);
      return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }] };
    }
    else if (name === "create-database") {
      let { parent_id, title, properties, icon, cover } = args;
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
      const { database_id, title, description, properties } = args;
      const updateParams = { database_id };
      if (title !== undefined) updateParams.title = title;
      if (description !== undefined) updateParams.description = description;
      if (properties !== undefined) updateParams.properties = properties;
      const response = await notionForUser.databases.update(updateParams);
      return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }] };
    }
    else if (name === "get-page") {
      let { page_id } = args;
      page_id = page_id.replace(/-/g, "");
      const response = await notionForUser.pages.retrieve({ page_id });
      return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }] };
    }
    else if (name === "get-block-children") {
      let { block_id, start_cursor, page_size } = args;
      block_id = block_id.replace(/-/g, "");
      const params = { block_id, page_size: page_size || 100 };
      if (start_cursor) params.start_cursor = start_cursor;
      const response = await notionForUser.blocks.children.list(params);
      return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }] };
    }
    else if (name === "append-block-children") {
      let { block_id, children, after } = args;
      block_id = block_id.replace(/-/g, "");
      const params = { block_id, children };
      if (after) params.after = after.replace(/-/g, "");
      const response = await notionForUser.blocks.children.append(params);
      return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }] };
    }
    else if (name === "update-block") {
      let { block_id, block_type, content, archived } = args;
      block_id = block_id.replace(/-/g, "");
      const updateParams = { block_id, [block_type]: content };
      if (archived !== undefined) updateParams.archived = archived;
      const response = await notionForUser.blocks.update(updateParams);
      return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }] };
    }
    else if (name === "get-block") {
      let { block_id } = args;
      block_id = block_id.replace(/-/g, "");
      const response = await notionForUser.blocks.retrieve({ block_id });
      return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }] };
    }
    else if (name === "search") {
      const { query, filter, sort, start_cursor, page_size } = args;
      const searchParams = { query: query || "", page_size: page_size || 100 };
      if (filter) searchParams.filter = filter;
      if (sort) searchParams.sort = sort;
      if (start_cursor) searchParams.start_cursor = start_cursor;
      const response = await notionForUser.search(searchParams);
      return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }] };
    }
    else {
      console.error(`[${sessionId}] Unknown tool called: ${name}`);
      return { isError: true, content: [{ type: "text", text: `Unknown tool: ${name}` }] };
    }
  } catch (error) {
    console.error(`[${sessionId}] Error executing tool '${name}':`, error.code, error.message);
    return { isError: true, content: [{ type: "text", text: `Error executing tool '${name}': ${error.message}` }] };
  }
});

// --- Express App Setup ---
const app = express();

app.get("/mcp", (req, res) => {
  const sessionId = uuidv4();
  console.error(`[${sessionId}] GET /mcp: New client connection. Assigning sessionId.`);

  const clientTransport = new SSEServerTransport("/mcp", res);
  clientTransport._customSessionId = sessionId;

  activeSessions.set(sessionId, { transport: clientTransport, notionApiKey: null });
  console.error(`[${sessionId}] Session created. Total active: ${activeSessions.size}`);

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  res.write(`event: mcp-session-id\ndata: ${JSON.stringify({ sessionId })}\n\n`);
  console.error(`[${sessionId}] Sent mcp-session-id event to client.`);

  res.on('close', () => {
    console.error(`[${sessionId}] GET /mcp: SSE connection closed by client.`);
    const session = activeSessions.get(sessionId);
    if (session && typeof session.transport?.close === 'function') {
        // session.transport.close();
    }
    activeSessions.delete(sessionId);
    console.error(`[${sessionId}] Session removed. Total active: ${activeSessions.size}`);
  });

  mcpServer.connect(clientTransport)
    .then(() => console.error(`[${sessionId}] MCP Server connected to transport.`))
    .catch(err => {
      console.error(`[${sessionId}] MCP handshake error:`, err);
      activeSessions.delete(sessionId);
    });
});

app.post("/mcp", (req, res) => {
  const sessionId = req.header("X-MCP-Session-ID");
  if (!sessionId) {
    console.error("POST /mcp: Missing X-MCP-Session-ID header.");
    return res.status(400).json({ error: "X-MCP-Session-ID header is required." });
  }
  const session = activeSessions.get(sessionId);
  if (session && session.transport) {
    console.error(`[${sessionId}] POST /mcp: Routing message to transport.`);
    session.transport.handlePostMessage(req, res);
  } else {
    console.error(`[${sessionId || 'unknown'}] POST /mcp: No active session/transport found for session ID.`);
    res.status(404).json({ error: "Session not found or transport unavailable. Re-establish SSE connection." });
  }
});

const PORT = process.env.PORT || 8787;
app.listen(PORT, "0.0.0.0", () => {
  console.error(`Notion MCP Server listening on http://0.0.0.0:${PORT}/mcp`);
});
