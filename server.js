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

 // --- Define server name and version as constants ---
const MY_SERVER_NAME = "notion-mcp-url-token";
const MY_SERVER_VERSION = "1.3.0";
const MCP_PROTOCOL_VERSION = "2024-11-05"; // Define your supported MCP version

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
  name: MY_SERVER_NAME,
  version: MY_SERVER_VERSION,
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

// --- 'initialize' Handler (Hardened and with extra logging) ---
mcpServer.setRequestHandler(
  z.object({ method: z.literal("initialize"), params: z.any().optional() }),
  async (jsonRpcRequest) => {
    const store = als.getStore();
    const userToken = store?.currentUserToken;
    const logPrefix = `[${userToken || 'initialize'}]`;

    console.error(`${logPrefix} MCP 'initialize' (URL token).`);

    const clientProvidedApiKeyInInitOptions = jsonRpcRequest.params?.initializationOptions?.notionApiKey;
    if (clientProvidedApiKeyInInitOptions) {
      console.warn(`${logPrefix} Client sent 'notionApiKey' in initializationOptions. Server uses key from URL token ('${userToken}').`);
    }

    // Explicitly construct the serverInfo and capabilities to be returned
    const serverInfoResponsePart = {
      name: MY_SERVER_NAME,
      version: MY_SERVER_VERSION
    };

    // --- FIX: Explicitly define the capabilities object here ---
    const capabilitiesResponsePart = {
      tools: {} // This server supports tools. Use an object, not a boolean, for MCP compatibility.
      // You could add other capabilities here if needed
    };

    const initializeResult = {
      protocolVersion: MCP_PROTOCOL_VERSION,
      serverInfo: serverInfoResponsePart,
      capabilities: capabilitiesResponsePart // Assign the explicitly defined object
    };

    // Your DEBUG log (optional, but good for seeing the object before stringify)
    console.error(`${logPrefix} [DEBUG] About to return InitializeResult object:`, initializeResult);
    console.error(`${logPrefix} Preparing to return InitializeResult:`, JSON.stringify(initializeResult, null, 2));

    // Defensive check before returning
    if (!initializeResult.serverInfo || typeof initializeResult.serverInfo.name === 'undefined') {
      console.error(`${logPrefix} CRITICAL ERROR: serverInfo or serverInfo.name is undefined before returning!`);
      // Fallback to a minimal valid structure if something went wrong
      return {
        protocolVersion: MCP_PROTOCOL_VERSION,
        serverInfo: { name: "fallback-server-name", version: "0.0.0" },
        capabilities: { tools: true } // Ensure fallback also has capabilities
      };
    }
    // Add a similar check for capabilities for robustness during debugging
    if (!initializeResult.capabilities || typeof initializeResult.capabilities.tools === 'undefined') {
        console.error(`${logPrefix} CRITICAL ERROR: capabilities or capabilities.tools is undefined before returning! Check construction of capabilitiesResponsePart.`);
         // Fallback for capabilities if something went wrong in its construction
        initializeResult.capabilities = { tools: true };
    }

    return initializeResult;
  }, { priority: 1 }
);

const allOriginalNotionTools = [
  { 
    name: "list-databases", 
    description: "List all databases in the user's Notion workspace.",
    inputSchema: {
      type: "object",
      properties: {
        concise: { type: "boolean", description: "If true, return a concise summary for each database. If false or omitted, return full details." }
      }
    }
  },
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
];

const userToolConfig = {
  "default_user_token": {
    tools: allOriginalNotionTools
  },
  "sjoerd_url_token": {
    tools: [
      ...allOriginalNotionTools,
      // { name: "notion_search_sjoerd_databases", description: "Search within Sjoerd's specific databases.", inputSchema: { type: "object", properties: { query: { type: "string" } } } },
      // { name: "notion_create_sjoerd_task", description: "Create a new task in Sjoerd's task database.", inputSchema: {type: "object", properties: { title: {type: "string"} }} },
      // { name: "notion_get_page_content", description: "Get content of a specific Notion page by ID.", inputSchema: {type: "object", properties: { page_id: { type: "string" }}} }
    ]
  },
  "wouter_url_token": {
    tools: [
      ...allOriginalNotionTools,
      // { name: "notion_query_wouter_projects", description: "Query Wouter's project database.", inputSchema: { type: "object", properties: { status: { type: "string", enum: ["active", "pending"] } } } },
      // { name: "notion_get_page_content", description: "Get content of a specific Notion page by ID.", inputSchema: {type: "object", properties: { page_id: { type: "string" }}} }
    ]
  },
  "leonie_url_token": {
    tools: [
      ...allOriginalNotionTools,
      // { name: "notion_leonie_custom_tool", description: "Leonie's custom test tool.", inputSchema: { type: "object", properties: { foo: { type: "string" } } } }
    ]
  }
  // Add other users as needed
};

mcpServer.setRequestHandler(z.object({ method: z.literal("tools/list") }),
  async (jsonRpcRequest) => {
    const store = als.getStore();
    const userToken = store?.currentUserToken || "default_user_token";
    const logPrefix = `[${userToken || 'tools/list'}]`;

    console.error(`${logPrefix} MCP 'tools/list' request.`);

    const configForUser = userToolConfig[userToken] || userToolConfig["default_user_token"];
    const toolsForUser = configForUser.tools.map(tool => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema || { type: "object", properties: {} }
    }));

    console.error(`${logPrefix} Returning ${toolsForUser.length} tools for user.`);
    return { tools: toolsForUser };
});

// --- 'tools/call' Handler (user-specific logic) ---
mcpServer.setRequestHandler(z.object({
  method: z.literal("tools/call"),
  params: z.object({ name: z.string(), arguments: z.any().optional() })
}), async (jsonRpcRequest) => {
  const { name, arguments: args } = jsonRpcRequest.params;
  const store = als.getStore();
  const userToken = store?.currentUserToken;
  const logPrefix = `[${userToken || 'tools/call'}:${name}]`;

  console.error(`${logPrefix} MCP 'tools/call' with args:`, JSON.stringify(args, null, 2));

  if (!userToken) {
    console.error(`${name}] CRITICAL: Could not get userToken from AsyncLocalStorage for tools/call.`);
    return { isError: true, content: [{ type: "text", text: "Internal Server Error: User token context lost." }] };
  }

  const sessionData = activeClientSessions.get(userToken);
  if (!sessionData || !sessionData.notionApiKey) {
    console.error(`[${userToken}] Tool '${name}': No Notion API Key found for this user token in session or default.`);
    return { isError: true, content: [{ type: "text", text: `Authorization Error: Notion API Key not configured for your session token.` }] };
  }

  const notionForUser = new NotionClient({ auth: sessionData.notionApiKey });
  console.log(`${logPrefix} Using API Key ending '...${sessionData.notionApiKey.slice(-4)}'.`);

  // Helper function to format and truncate tool output
  function formatToolOutput(responseData, currentToolName) {
    const toolLogPrefix = `[${userToken || 'tools/call'}:${currentToolName || 'unknown_tool'}]`;
    let outputText;
    try {
      if (responseData === undefined || responseData === null) {
        console.warn(`${toolLogPrefix} Response data is undefined or null. Returning empty string content.`);
        return { content: [{ type: "text", text: "" }] };
      }
      outputText = JSON.stringify(responseData, null, 2);
    } catch (stringifyError) {
      console.error(`${toolLogPrefix} Error stringifying responseData:`, stringifyError);
      return { isError: true, content: [{ type: "text", text: "Internal Server Error: Could not serialize tool output." }] };
    }

    const maxLength = 50000;
    if (outputText.length > maxLength) {
      const originalLength = outputText.length;
      const truncatedText = outputText.substring(0, maxLength);
      const truncationMessage = `Output was too long: total ${originalLength}. Truncated to 50.000 characters.\n`;
      console.warn(`${toolLogPrefix} Output truncated. Original length: ${originalLength}, new length: ${maxLength}.`);
      return { content: [{ type: "text", text: truncationMessage + truncatedText }] };
    } else {
      return { content: [{ type: "text", text: outputText }] };
    }
  }

  try {
    // --- User Sjoerd's Tools ---
    // if (userToken === "sjoerd_url_token") {
    //   if (name === "notion_search_sjoerd_databases") {
    //     // Example: Sjoerd has a specific set of database IDs to search
    //     const sjoerdsDatabaseIds = ["db_id_1", "db_id_2"]; // TODO: Replace with real IDs
    //     const searchPromises = sjoerdsDatabaseIds.map(dbId =>
    //       notionForUser.databases.query({ database_id: dbId, filter: { property: "Name", title: { contains: args.query } } })
    //     );
    //     const results = await Promise.all(searchPromises);
    //     return formatToolOutput(results.flat(), name);
    //   }
    //   if (name === "notion_create_sjoerd_task") {
    //     const sjoerdsTaskDbId = "sjoerds_task_db_id"; // TODO: Replace with real ID
    //     const response = await notionForUser.pages.create({
    //       parent: { database_id: sjoerdsTaskDbId },
    //       properties: { Title: { title: [{ text: { content: args.title } }] } }
    //     });
    //     return formatToolOutput(response, name);
    //   }
    //   if (name === "notion_get_page_content") {
    //     let { page_id } = args || {};
    //     page_id = page_id.replace(/-/g, "");
    //     const pageContent = await notionForUser.blocks.children.list({ block_id: page_id });
    //     return formatToolOutput(pageContent.results, name);
    //   }
    // }

    // --- User Wouter's Tools ---
    // if (userToken === "wouter_url_token") {
    //   if (name === "notion_query_wouter_projects") {
    //     const woutersProjectDbId = "wouters_project_db_id"; // TODO: Replace with real ID
    //     const response = await notionForUser.databases.query({
    //       database_id: woutersProjectDbId,
    //       filter: { property: "Status", select: { equals: args.status } }
    //     });
    //     return formatToolOutput(response, name);
    //   }
    //   if (name === "notion_get_page_content") {
    //     let { page_id } = args || {};
    //     page_id = page_id.replace(/-/g, "");
    //     const pageContent = await notionForUser.blocks.children.list({ block_id: page_id });
    //     return formatToolOutput(pageContent.results, name);
    //   }
    // }

    // --- User Leonie's Tools ---
    // if (userToken === "leonie_url_token") {
    //   if (name === "notion_leonie_custom_tool") {
    //     // Example custom tool for Leonie
    //     return formatToolOutput(`Leonie's custom tool executed with foo: ${args.foo}`, name);
    //   }
    // }

    // --- Standard 12 Notion Tools for all users ---
    if (name === "list-databases") {
      const concise = args && typeof args.concise === "boolean" ? args.concise : false;
      const response = await notionForUser.search({ filter: { property: "object", value: "database" }, page_size: 100, sort: { direction: "descending", timestamp: "last_edited_time" } });
      if (concise) {
        // Only return id, title, and created_time/last_edited_time for each database
        const conciseResults = response.results.map(db => ({
          id: db.id,
          title: db.title && Array.isArray(db.title) && db.title.length > 0
            ? (db.title[0].plain_text || db.title[0].text?.content || "")
            : "",
          created_time: db.created_time,
          last_edited_time: db.last_edited_time
        }));
        return formatToolOutput(conciseResults, name);
      } else {
        return formatToolOutput(response.results, name);
      }
    }
    else if (name === "query-database") {
      const { database_id, filter, sorts, start_cursor, page_size } = args || {};
      if (!database_id) {
        return { isError: true, content: [{ type: "text", text: "Error: database_id is required for query-database."}] };
      }
      const queryParams = { database_id, page_size: page_size || 100, filter, sorts, start_cursor };
      Object.keys(queryParams).forEach(key => queryParams[key] === undefined && delete queryParams[key]);
      const response = await notionForUser.databases.query(queryParams);
      return formatToolOutput(response, name);
    }
    else if (name === "create-page") {
      const { parent_id, properties, children } = args || {};
      const pageParams = { parent: { database_id: parent_id }, properties };
      if (children) pageParams.children = children;
      const response = await notionForUser.pages.create(pageParams);
      return formatToolOutput(response, name);
    }
    else if (name === "update-page") {
      const { page_id, properties, archived } = args || {};
      const updateParams = { page_id, properties };
      if (archived !== undefined) updateParams.archived = archived;
      const response = await notionForUser.pages.update(updateParams);
      return formatToolOutput(response, name);
    }
    else if (name === "create-database") {
      let { parent_id, title, properties, icon, cover } = args || {};
      parent_id = parent_id.replace(/-/g, "");
      const databaseParams = { parent: { type: "page_id", page_id: parent_id }, title, properties };
      if (icon && icon.type === "emoji" && !icon.emoji) {
        icon.emoji = "";
        databaseParams.icon = icon;
      } else if (icon) {
        databaseParams.icon = icon;
      }
      if (cover) databaseParams.cover = cover;
      const response = await notionForUser.databases.create(databaseParams);
      return formatToolOutput(response, name);
    }
    else if (name === "update-database") {
      const { database_id, title, description, properties: db_properties } = args || {};
      const updateParams = { database_id };
      if (title !== undefined) updateParams.title = title;
      if (description !== undefined) updateParams.description = description;
      if (db_properties !== undefined) updateParams.properties = db_properties;
      const response = await notionForUser.databases.update(updateParams);
      return formatToolOutput(response, name);
    }
    else if (name === "get-page" || (name === "notion_get_page_content" && (userToken === "sjoerd_url_token" || userToken === "wouter_url_token" || userToken === "default_user_token"))) {
      let { page_id } = args || {};
      page_id = page_id.replace(/-/g, "");
      const response = await notionForUser.pages.retrieve({ page_id });
      return formatToolOutput(response, name);
    }
    else if (name === "get-block-children") {
      let { block_id, start_cursor, page_size } = args || {};
      block_id = block_id.replace(/-/g, "");
      const params = { block_id, page_size: page_size || 100 };
      if (start_cursor) params.start_cursor = start_cursor;
      const response = await notionForUser.blocks.children.list(params);
      return formatToolOutput(response, name);
    }
    else if (name === "append-block-children") {
      let { block_id, children, after } = args || {};
      block_id = block_id.replace(/-/g, "");
      const params = { block_id, children };
      if (after) params.after = after.replace(/-/g, "");
      const response = await notionForUser.blocks.children.append(params);
      return formatToolOutput(response, name);
    }
    else if (name === "update-block") {
      let { block_id, block_type, content, archived } = args || {};
      block_id = block_id.replace(/-/g, "");
      const updateParams = { block_id, [block_type]: content };
      if (archived !== undefined) updateParams.archived = archived;
      const response = await notionForUser.blocks.update(updateParams);
      return formatToolOutput(response, name);
    }
    else if (name === "get-block") {
      let { block_id } = args || {};
      block_id = block_id.replace(/-/g, "");
      const response = await notionForUser.blocks.retrieve({ block_id });
      return formatToolOutput(response, name);
    }
    else if (name === "search") {
      const { query, filter, sort, start_cursor, page_size } = args || {};
      const searchParams = { query: query || "", page_size: page_size || 100 };
      if (filter) searchParams.filter = filter;
      if (sort) searchParams.sort = sort;
      if (start_cursor) searchParams.start_cursor = start_cursor;
      const response = await notionForUser.search(searchParams);
      return formatToolOutput(response, name);
    }

    // Fallback for unknown tool
    console.error(`${logPrefix} Unknown tool or tool not available for this user.`);
    return { isError: true, content: [{ type: "text", text: `Tool '${name}' not found or not available for your current user context.` }] };

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
