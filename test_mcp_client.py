import requests
import json
import time
import uuid

# --- Configuration ---
BASE_URL = "http://127.0.0.1:8080"  # Your Node.js MCP server address
MCP_ENDPOINT = f"{BASE_URL}/mcp"
REQUEST_ID_COUNTER = 0

# --- Helper to generate MCP request IDs ---
def next_request_id():
    global REQUEST_ID_COUNTER
    REQUEST_ID_COUNTER += 1
    return REQUEST_ID_COUNTER

# --- Function to establish SSE and get session ID ---
def get_mcp_session(sse_url):
    print(f"Attempting to connect to SSE endpoint: {sse_url}")
    headers = {'Accept': 'text/event-stream'}
    session_id = None
    
    try:
        # Note: 'requests' for SSE is basic. For robust SSE, libraries like 'sseclient-py' or 'httpx' are better.
        # This simplified version will try to get the first event containing the session ID.
        with requests.get(sse_url, stream=True, headers=headers, timeout=10) as response:
            response.raise_for_status()
            print(f"Successfully connected to SSE. Status: {response.status_code}")
            print("Listening for mcp-session-id event...")

            current_event_name = None
            for line_bytes in response.iter_lines():
                if not line_bytes: # Empty line signifies end of an event
                    current_event_name = None
                    continue

                line = line_bytes.decode('utf-8')
                # print(f"SSE RAW LINE: {line}") # For debugging SSE lines

                if line.startswith('event:'):
                    current_event_name = line[len('event:'):].strip()
                elif line.startswith('data:') and current_event_name == 'mcp-session-id':
                    data_content = line[len('data:'):].strip()
                    try:
                        data_json = json.loads(data_content)
                        if 'sessionId' in data_json:
                            session_id = data_json['sessionId']
                            print(f"SUCCESS: Received mcp-session-id: {session_id}")
                            return session_id # Got the ID, exit function
                        else:
                            print(f"WARNING: 'sessionId' not in mcp-session-id event data: {data_json}")
                    except json.JSONDecodeError:
                        print(f"ERROR: Could not decode JSON from mcp-session-id data: {data_content}")
                    current_event_name = None # Reset after processing data
                elif line.startswith('data:'): # Other data events
                    print(f"SSE Data (other event: {current_event_name}): {line[len('data:'):].strip()}")
                    current_event_name = None


            if not session_id:
                print("ERROR: Did not receive mcp-session-id event after listening.")

    except requests.exceptions.RequestException as e:
        print(f"ERROR: SSE connection failed: {e}")
    except Exception as e:
        print(f"ERROR: An unexpected error occurred during SSE handling: {e}")
        
    return session_id

# --- Function to send MCP POST requests ---
def send_mcp_request(mcp_url, session_id, method, params=None):
    if not session_id:
        print(f"ERROR: No session ID provided for MCP request '{method}'. Cannot send.")
        return None

    headers = {
        "Content-Type": "application/json-rpc", # Or "application/json" if server expects that
        "X-MCP-Session-ID": session_id
    }
    payload = {
        "jsonrpc": "2.0",
        "id": next_request_id(),
        "method": method,
    }
    if params is not None:
        payload["params"] = params

    print(f"\n--- Sending MCP Request ---")
    print(f"URL: {mcp_url}")
    print(f"Method: {method}")
    print(f"Headers: {json.dumps(headers)}")
    print(f"Payload: {json.dumps(payload, indent=2)}")

    try:
        response = requests.post(mcp_url, json=payload, headers=headers, timeout=10)
        print(f"Response Status: {response.status_code}")
        if response.text:
            try:
                response_data = response.json()
                print(f"Response JSON: {json.dumps(response_data, indent=2)}")
                return response_data
            except json.JSONDecodeError:
                print(f"ERROR: Could not decode JSON from response. Raw text: {response.text}")
                return {"error": "Non-JSON response", "status_code": response.status_code, "text": response.text}
        else:
            print("WARNING: Empty response from server.")
            return {"error": "Empty response", "status_code": response.status_code}
            
    except requests.exceptions.RequestException as e:
        print(f"ERROR: MCP POST request failed: {e}")
        if hasattr(e, 'response') and e.response is not None:
             print(f"Error Response Text: {e.response.text}")
        return None

# --- Main Test Logic ---
if __name__ == "__main__":
    print("Starting MCP Test Client...")

    # 1. Establish SSE connection and get session ID
    session_id = get_mcp_session(MCP_ENDPOINT)

    if not session_id:
        print("\nCRITICAL: Could not obtain session ID. Aborting further tests.")
    else:
        print(f"\nObtained Session ID: {session_id}. Proceeding with MCP calls.")

        # 2. Send 'initialize' request with a dummy Notion API key
        # This key should be picked up by your Node.js server for this session
        dummy_user_api_key = f"dummy_notion_key_{uuid.uuid4()}" 
        print(f"Using dummy API key for initialize: {dummy_user_api_key}")
        
        initialize_params = {
            "protocolVersion": "2024-11-05", # Use a recent or expected version
            "clientInfo": {"name": "python-test-client", "version": "0.1.0"},
            "capabilities": {}, # Client capabilities (can be empty)
            "initializationOptions": {
                "notionApiKey": dummy_user_api_key
            }
        }
        init_response = send_mcp_request(MCP_ENDPOINT, session_id, "initialize", initialize_params)
        if init_response and "result" in init_response:
            print("SUCCESS: 'initialize' call successful.")
            # The server should log that it stored this dummy_user_api_key for this session.
        else:
            print("ERROR: 'initialize' call failed or returned unexpected response.")
            # No point in continuing if initialize fails
            exit()

        time.sleep(1) # Small pause

        # 3. Send 'tools/list' request
        list_tools_response = send_mcp_request(MCP_ENDPOINT, session_id, "tools/list")
        if list_tools_response and "result" in list_tools_response and "tools" in list_tools_response["result"]:
            print("SUCCESS: 'tools/list' call successful.")
            print(f"Found {len(list_tools_response['result']['tools'])} tools.")
        else:
            print("ERROR: 'tools/list' call failed or returned unexpected tool structure.")

        time.sleep(1) # Small pause

        # 4. Send 'tools/call' for 'list-databases'
        # The server should use the dummy_user_api_key provided during initialize for this call.
        # Since it's a dummy key, the Notion API call itself will likely fail,
        # but the MCP server should attempt it with THIS key.
        # Your Node.js server logs are crucial to verify which key was used.
        list_databases_args = {} # list-databases takes no arguments from LLM
        
        call_tool_response = send_mcp_request(MCP_ENDPOINT, session_id, "tools/call", {
            "name": "list-databases",
            "arguments": list_databases_args
        })
        
        if call_tool_response:
            print("INFO: 'tools/call' for 'list-databases' completed.")
            if "result" in call_tool_response:
                 print("SUCCESS: 'list-databases' tool call returned a result (might be an error from Notion if key is dummy).")
            elif "error" in call_tool_response:
                 print(f"INFO: 'list-databases' tool call returned an MCP error: {call_tool_response['error']}")
            # Check your Node.js server logs to confirm:
            # - If it logged receiving the `dummy_user_api_key` during initialize for this session.
            # - If it logged using this `dummy_user_api_key` (or attempting to) for the list-databases call.
            # - If Notion API itself returned an unauthorized error due to the dummy key, that's expected.
        else:
            print("ERROR: 'tools/call' for 'list-databases' failed to get a response.")

    print("\nTest script finished.")