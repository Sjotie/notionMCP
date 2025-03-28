#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { Client } from "@notionhq/client";
import dotenv from "dotenv";

// Load environment variables
dotenv.config();

// Initialize Notion client
const notion = new Client({
  auth: process.env.NOTION_API_KEY,
});

// Create MCP server
const server = new Server({
  name: "notion-mcp",
  version: "1.0.0",
}, {
  capabilities: {
    tools: {}
  }
});

// Add a request interceptor for debugging
server.setRequestHandler(z.object({
  method: z.string(),
  params: z.any().optional()
}), async (request) => {
  console.error("Received request:", JSON.stringify(request, null, 2));
  
  // Let the request continue to be handled by other handlers
  return undefined;
}, { priority: -1 });

// List databases tool
server.setRequestHandler(z.object({
  method: z.literal("tools/list")
}), async () => {
  return {
    tools: [
      {
        name: "list-databases",
        description: "List all databases the integration has access to",
        inputSchema: {
          type: "object",
          properties: {}
        }
      },
      {
        name: "query-database",
        description: "Query a database",
        inputSchema: {
          type: "object",
          properties: {
            database_id: {
              type: "string",
              description: "ID of the database to query"
            },
            filter: {
              type: "object",
              description: "Optional filter criteria"
            },
            sorts: {
              type: "array",
              description: "Optional sort criteria"
            },
            start_cursor: {
              type: "string",
              description: "Optional cursor for pagination"
            },
            page_size: {
              type: "number",
              description: "Number of results per page",
              default: 100
            }
          },
          required: ["database_id"]
        }
      },
      {
        name: "create-page",
        description: "Create a new page in a database",
        inputSchema: {
          type: "object",
          properties: {
            parent_id: {
              type: "string",
              description: "ID of the parent database"
            },
            properties: {
              type: "object",
              description: "Page properties"
            },
            children: {
              type: "array",
              description: "Optional content blocks"
            }
          },
          required: ["parent_id", "properties"]
        }
      },
      {
        name: "update-page",
        description: "Update an existing page",
        inputSchema: {
          type: "object",
          properties: {
            page_id: {
              type: "string",
              description: "ID of the page to update"
            },
            properties: {
              type: "object",
              description: "Updated page properties"
            },
            archived: {
              type: "boolean",
              description: "Whether to archive the page"
            }
          },
          required: ["page_id", "properties"]
        }
      },
      {
        name: "create-database",
        description: "Create a new database",
        inputSchema: {
          type: "object",
          properties: {
            parent_id: {
              type: "string",
              description: "ID of the parent page"
            },
            title: {
              type: "array",
              description: "Database title as rich text array"
            },
            properties: {
              type: "object",
              description: "Database properties schema"
            },
            icon: {
              type: "object",
              description: "Optional icon for the database"
            },
            cover: {
              type: "object",
              description: "Optional cover for the database"
            }
          },
          required: ["parent_id", "title", "properties"]
        }
      },
      {
        name: "update-database",
        description: "Update an existing database",
        inputSchema: {
          type: "object",
          properties: {
            database_id: {
              type: "string",
              description: "ID of the database to update"
            },
            title: {
              type: "array",
              description: "Optional new title as rich text array"
            },
            description: {
              type: "array",
              description: "Optional new description as rich text array"
            },
            properties: {
              type: "object",
              description: "Optional updated properties schema"
            }
          },
          required: ["database_id"]
        }
      },
      {
        name: "get-page",
        description: "Retrieve a page by its ID",
        inputSchema: {
          type: "object",
          properties: {
            page_id: {
              type: "string",
              description: "ID of the page to retrieve"
            }
          },
          required: ["page_id"]
        }
      },
      {
        name: "get-block-children",
        description: "Retrieve the children blocks of a block",
        inputSchema: {
          type: "object",
          properties: {
            block_id: {
              type: "string",
              description: "ID of the block (page or block)"
            },
            start_cursor: {
              type: "string",
              description: "Cursor for pagination"
            },
            page_size: {
              type: "number",
              description: "Number of results per page",
              default: 100
            }
          },
          required: ["block_id"]
        }
      },
      {
        name: "append-block-children",
        description: "Append blocks to a parent block",
        inputSchema: {
          type: "object",
          properties: {
            block_id: {
              type: "string",
              description: "ID of the parent block (page or block)"
            },
            children: {
              type: "array",
              description: "List of block objects to append"
            },
            after: {
              type: "string",
              description: "Optional ID of an existing block to append after"
            }
          },
          required: ["block_id", "children"]
        }
      },
      {
        name: "update-block",
        description: "Update a block's content or archive status",
        inputSchema: {
          type: "object",
          properties: {
            block_id: {
              type: "string",
              description: "ID of the block to update"
            },
            block_type: {
              type: "string",
              description: "The type of block (paragraph, heading_1, to_do, etc.)"
            },
            content: {
              type: "object",
              description: "The content for the block based on its type"
            },
            archived: {
              type: "boolean",
              description: "Whether to archive (true) or restore (false) the block"
            }
          },
          required: ["block_id", "block_type", "content"]
        }
      },
      {
        name: "get-block",
        description: "Retrieve a block by its ID",
        inputSchema: {
          type: "object",
          properties: {
            block_id: {
              type: "string",
              description: "ID of the block to retrieve"
            }
          },
          required: ["block_id"]
        }
      },
      {
        name: "search",
        description: "Search Notion for pages or databases",
        inputSchema: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "Search query string",
              default: ""
            },
            filter: {
              type: "object",
              description: "Optional filter criteria"
            },
            sort: {
              type: "object",
              description: "Optional sort criteria"
            },
            start_cursor: {
              type: "string",
              description: "Cursor for pagination"
            },
            page_size: {
              type: "number",
              description: "Number of results per page",
              default: 100
            }
          }
        }
      }
    ]
  };
});

// Define a single CallToolRequestSchema handler for all tools
server.setRequestHandler(z.object({
  method: z.literal("tools/call"),
  params: z.object({
    name: z.string(),
    arguments: z.any()
  })
}), async (request) => {
  const { name, arguments: args } = request.params;
  
  try {
    // Handle each tool based on name
    if (name === "list-databases") {
      const response = await notion.search({
        filter: {
          property: "object",
          value: "database",
        },
        page_size: 100,
        sort: {
          direction: "descending",
          timestamp: "last_edited_time",
        },
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(response.results, null, 2),
          },
        ],
      };
    }

    else if (name === "query-database") {
      console.error("Query database handler called with:", JSON.stringify(args, null, 2));
      const { database_id, filter, sorts, start_cursor, page_size } = args;
      
      const queryParams = {
        database_id,
        page_size: page_size || 100,
      };

      if (filter) queryParams.filter = filter;
      if (sorts) queryParams.sorts = sorts;
      if (start_cursor) queryParams.start_cursor = start_cursor;

      const response = await notion.databases.query(queryParams);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(response, null, 2),
          },
        ],
      };
    }

    else if (name === "create-page") {
      const { parent_id, properties, children } = args;
      
      const pageParams = {
        parent: { database_id: parent_id },
        properties,
      };

      if (children) {
        pageParams.children = children;
      }

      const response = await notion.pages.create(pageParams);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(response, null, 2),
          },
        ],
      };
    }

    else if (name === "update-page") {
      const { page_id, properties, archived } = args;
      
      const updateParams = {
        page_id,
        properties,
      };

      if (archived !== undefined) {
        updateParams.archived = archived;
      }

      const response = await notion.pages.update(updateParams);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(response, null, 2),
          },
        ],
      };
    }

    else if (name === "create-database") {
      let { parent_id, title, properties, icon, cover } = args;
      
      // Remove dashes if present in parent_id
      parent_id = parent_id.replace(/-/g, "");

      const databaseParams = {
        parent: {
          type: "page_id",
          page_id: parent_id,
        },
        title,
        properties,
      };

      // Set default emoji if icon is specified but emoji is empty
      if (icon && icon.type === "emoji" && !icon.emoji) {
        icon.emoji = "📄"; // Default document emoji
        databaseParams.icon = icon;
      } else if (icon) {
        databaseParams.icon = icon;
      }

      if (cover) {
        databaseParams.cover = cover;
      }

      const response = await notion.databases.create(databaseParams);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(response, null, 2),
          },
        ],
      };
    }

    else if (name === "update-database") {
      const { database_id, title, description, properties } = args;
      
      const updateParams = {
        database_id,
      };

      if (title !== undefined) {
        updateParams.title = title;
      }

      if (description !== undefined) {
        updateParams.description = description;
      }

      if (properties !== undefined) {
        updateParams.properties = properties;
      }

      const response = await notion.databases.update(updateParams);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(response, null, 2),
          },
        ],
      };
    }

    else if (name === "get-page") {
      let { page_id } = args;
      
      // Remove dashes if present in page_id
      page_id = page_id.replace(/-/g, "");

      const response = await notion.pages.retrieve({ page_id });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(response, null, 2),
          },
        ],
      };
    }

    else if (name === "get-block-children") {
      let { block_id, start_cursor, page_size } = args;
      
      // Remove dashes if present in block_id
      block_id = block_id.replace(/-/g, "");

      const params = {
        block_id,
        page_size: page_size || 100,
      };

      if (start_cursor) {
        params.start_cursor = start_cursor;
      }

      const response = await notion.blocks.children.list(params);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(response, null, 2),
          },
        ],
      };
    }

    else if (name === "append-block-children") {
      let { block_id, children, after } = args;
      
      // Remove dashes if present in block_id
      block_id = block_id.replace(/-/g, "");

      const params = {
        block_id,
        children,
      };

      if (after) {
        params.after = after.replace(/-/g, ""); // Ensure after ID is properly formatted
      }

      const response = await notion.blocks.children.append(params);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(response, null, 2),
          },
        ],
      };
    }

    else if (name === "update-block") {
      let { block_id, block_type, content, archived } = args;
      
      // Remove dashes if present in block_id
      block_id = block_id.replace(/-/g, "");

      const updateParams = {
        block_id,
        [block_type]: content,
      };

      if (archived !== undefined) {
        updateParams.archived = archived;
      }

      const response = await notion.blocks.update(updateParams);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(response, null, 2),
          },
        ],
      };
    }

    else if (name === "get-block") {
      let { block_id } = args;
      
      // Remove dashes if present in block_id
      block_id = block_id.replace(/-/g, "");

      const response = await notion.blocks.retrieve({ block_id });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(response, null, 2),
          },
        ],
      };
    }

    else if (name === "search") {
      const { query, filter, sort, start_cursor, page_size } = args;
      
      const searchParams = {
        query: query || "",
        page_size: page_size || 100,
      };

      if (filter) {
        searchParams.filter = filter;
      }

      if (sort) {
        searchParams.sort = sort;
      }

      if (start_cursor) {
        searchParams.start_cursor = start_cursor;
      }

      const response = await notion.search(searchParams);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(response, null, 2),
          },
        ],
      };
    }
    
    // If we get here, the tool name wasn't recognized
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: `Unknown tool: ${name}`,
        },
      ],
    };
  } catch (error) {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: `Error executing ${name}: ${error.message}`,
        },
      ],
    };
  }
});

// Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Notion MCP Server running on stdio");
}

// Add error handling for unhandled rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

main().catch((error) => {
  console.error("Fatal error in main():", error);
  process.exit(1);
});
