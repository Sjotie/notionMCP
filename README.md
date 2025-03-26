# Notion MCP Server

A Model Context Protocol (MCP) server that connects Claude and other AI assistants to your Notion workspace. This integration allows AI assistants to interact with your Notion databases, pages, and blocks.

## What is this?

This tool acts as a bridge between AI assistants (like Claude) and your Notion workspace. It allows the AI to:
- View and search your Notion databases
- Create and update pages
- Manage content blocks
- And much more!

## Step-by-Step Setup Guide

### Prerequisites
- [Node.js](https://nodejs.org/) (version 14 or higher)
- A Notion account
- Claude Desktop app (if using with Claude)

### 1. Getting Your Notion API Key

1. Go to [https://www.notion.so/my-integrations](https://www.notion.so/my-integrations)
2. Click the blue **"+ New integration"** button
3. Fill in the details:
   - **Name**: Choose a name like "Claude Assistant" or "AI Helper"
   - **Logo**: Optional
   - **Associated workspace**: Select your Notion workspace
4. Click **"Submit"**
5. On the next page, find the **"Internal Integration Token"** section
6. Click **"Show"** and copy the token (it starts with `secret_`)

## 2. Setting Up This Server

### Download the Repository

**Option A: Download as ZIP (Recommended for beginners)**
1. Go to the GitHub repository: https://github.com/Sjotie/notionMCP/
2. Click the green "Code" button at the top right
3. Select "Download ZIP"
4. Once downloaded, extract the ZIP file to a location on your computer
   - Windows: Right-click the ZIP file and select "Extract All"
   - Mac: Double-click the ZIP file to extract

**Option B: Clone with Git (For users familiar with Git)**
1. Open a command prompt or terminal
   - Windows: Press `Win+R`, type `cmd`, and press Enter
   - Mac: Open Terminal from Applications > Utilities
2. Navigate to where you want to store the repository
   ```
   cd path/to/desired/location
   ```
3. Clone the repository
   ```
   git clone https://github.com/Sjotie/notionMCP/
   ```

### Navigate to the Project Directory

After downloading or cloning, you need to navigate to the project folder using the `cd` (change directory) command:

**If you downloaded the ZIP (Option A):**
1. Open a command prompt or terminal
2. Use the `cd` command to navigate to where you extracted the ZIP file:
   ```
   cd path/to/extracted/folder/notionMCP
   ```
   
   For example:
   - On Windows: `cd C:\Users\YourName\Downloads\notionMCP`
   - On Mac: `cd /Users/YourName/Downloads/notionMCP`

**If you cloned with Git (Option B):**
1. The repository should have been cloned into a folder named "notionMCP"
2. If you're still in the same terminal window after cloning, simply type:
   ```
   cd notionMCP
   ```

**How to know you're in the right directory:**
- After using the `cd` command, you can check your current location:
  - On Windows: Type `dir` and press Enter - you should see files like `server.js`
  - On Mac: Type `ls` and press Enter - you should see files like `server.js`

### Install Dependencies

Once you're in the notionMCP directory, install the required dependencies:

```
npm install
```

This will install all the necessary Node.js packages. You should see a progress bar and eventually a message indicating the installation is finished. It might say something along the lines of "X Packages are looking for funding" - this is completely normal and means it worked.

### 3. Connecting to Notion Pages

For security, Notion requires you to explicitly grant access to each page or database:

1. Open Notion and navigate to a page or database you want the AI to access
2. Click the **"•••"** (three dots) in the top-right corner
3. Select **"Add connections"**
4. Find and select the integration you created earlier
5. Repeat for any other pages or databases you want to make accessible

### 4. Connecting to Claude Desktop

1. Locate your Claude Desktop configuration file:
   - Windows: `%APPDATA%\Claude\claude_desktop_config.json`
     (Type this path in File Explorer address bar)
   - Mac: `~/Library/Application Support/Claude/claude_desktop_config.json`
     (In Finder, press Cmd+Shift+G and paste this path)

2. Open the file in a text editor. If it doesn't exist, create it with the following content:
   ```json
   {
     "mcpServers": {
       "notion": {
         "command": "node",
         "args": [
           "C:\\path\\to\\notion-mcp-server\\server.js"
         ],
         "env": {
           "NOTION_API_KEY": "your_notion_api_key_here"
         }
       }
     }
   }
   ```

3. Replace:
   - `C:\\path\\to\\notion-mcp-server\\server.js` with the actual path to the server.js file
     - Windows: Use double backslashes (\\\\) in the path
     - Mac: Use forward slashes (/)
   - `your_notion_api_key_here` with your Notion API key

4. Save the file and restart Claude Desktop

### 5. Testing the Connection

1. Start a new conversation in Claude
2. Ask Claude to interact with your Notion workspace, for example:
   - "Show me a list of my Notion databases"
   - "Create a new page in my Tasks database with title 'Test Task'"

## Available Tools

The server provides these tools to AI assistants:

- **list-databases**: View all accessible databases
- **query-database**: Get entries from a database
- **create-page**: Add a new page to a database
- **update-page**: Modify an existing page
- **create-database**: Create a new database
- **update-database**: Modify a database structure
- **get-page**: View a specific page
- **get-block-children**: View content blocks
- **append-block-children**: Add content to a page
- **update-block**: Edit content blocks
- **get-block**: View a specific block
- **search**: Find content across your workspace

## Troubleshooting

### Common Issues:

1. **"Connection failed" in Claude**
   - Make sure the server path in claude_desktop_config.json is correct
   - Check that your Notion API key is valid
   - Ensure Node.js is installed

2. **"Access denied" when accessing Notion content**
   - Make sure you've shared the page/database with your integration
   - Check that your API key has the necessary permissions

3. **Server won't start**
   - Ensure all dependencies are installed (`npm install`)
   - Check that the .env file exists with your API key

### Getting Help

If you encounter issues not covered here, please:
- Check the console output for error messages
- Ensure your Notion API key is valid
- Verify that your integration has access to the pages/databases

## License

MIT
