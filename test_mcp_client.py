import requests
import json
import time
import uuid # For dummy API keys

# --- Configuration ---
BASE_URL = "http://127.0.0.1:8080"
MCP_ENDPOINT = f"{BASE_URL}/mcp"
REQUEST_ID_COUNTER = 0

# --- Helper to generate MCP request IDs ---
def next_request_id():
    global REQUEST_ID_COUNTER
    REQUEST_ID_COUNTER += 1
    return REQUEST_ID_COUNTER

# --- Function to send MCP POST requests ---
def send_mcp_post_request(session_id, method, params=None):
    if not session_id:
        print(f"ERROR: No session ID provided for MCP POST request '{method}'.")
        return None

    headers = {
        "Content-Type": "application/json-rpc",
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
    print(f"URL: {MCP_ENDPOINT}")
    print(f"Method: {method}")
    print(f"Headers: {json.dumps(headers)}")
    print(f"Payload: {json.dumps(payload, indent=2)}")

    try:
        response = requests.post(MCP_ENDPOINT, json=payload, headers=headers, timeout=15) # Increased timeout
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
def run_tests():
    print("Starting MCP Test Client...")
    session_id_from_sse = None

    print(f"Attempting to connect to SSE endpoint: {MCP_ENDPOINT}")
    sse_headers = {'Accept': 'text/event-stream'}
    
    try:
        # Establish and keep the SSE connection open within this 'with' block
        with requests.get(MCP_ENDPOINT, stream=True, headers=sse_headers, timeout=10) as sse_response:
            sse_response.raise_for_status()
            print(f"Successfully connected to SSE. Status: {sse_response.status_code}")
            print("Listening for mcp-session-id event...")

            current_event_name = None
            # Iterate over the SSE stream to find the session ID
            # This loop will consume lines. We expect the session ID early.
            for line_bytes in sse_response.iter_lines(): # Add timeout here if sse_response itself needs it for iteration
                if not line_bytes:  # Empty line signifies end of an event
                    current_event_name = None
                    continue
                
                line = line_bytes.decode('utf-8')
                # print(f"SSE RAW LINE: {line}") # Uncomment for deep SSE debugging

                if line.startswith('event:'):
                    current_event_name = line[len('event:'):].strip()
                elif line.startswith('data:') and current_event_name == 'mcp-session-id':
                    data_content = line[len('data:'):].strip()
                    try:
                        data_json = json.loads(data_content)
                        if 'sessionId' in data_json:
                            session_id_from_sse = data_json['sessionId']
                            print(f"SUCCESS: Received mcp-session-id: {session_id_from_sse}")
                            # Got the session ID, now proceed with POST requests
                            # WHILE THE SSE CONNECTION (sse_response) IS STILL OPEN
                            
                            # 2. Send 'initialize' request
                            dummy_user_api_key = f"dummy_notion_key_{uuid.uuid4()}"
                            print(f"Using dummy API key for initialize: {dummy_user_api_key}")
                            initialize_params = {
                                "protocolVersion": "2024-11-05",
                                "clientInfo": {"name": "python-test-client", "version": "0.1.0"},
                                "capabilities": {},
                                "initializationOptions": {"notionApiKey": dummy_user_api_key}
                            }
                            init_response = send_mcp_post_request(session_id_from_sse, "initialize", initialize_params)
                            if not (init_response and "result" in init_response):
                                print("ERROR: 'initialize' call failed or returned unexpected response. Test ending.")
                                return # Exit run_tests if initialize fails

                            time.sleep(0.2) # Brief pause

                            # 3. Send 'tools/list' request
                            list_tools_response = send_mcp_post_request(session_id_from_sse, "tools/list")
                            if list_tools_response and "result" in list_tools_response and "tools" in list_tools_response["result"]:
                                print("SUCCESS: 'tools/list' call successful.")
                            else:
                                print("ERROR: 'tools/list' call failed or returned unexpected tool structure.")
                            
                            time.sleep(0.2)

                            # 4. Send 'tools/call' for 'list-databases'
                            call_tool_response = send_mcp_post_request(session_id_from_sse, "tools/call", {
                                "name": "list-databases",
                                "arguments": {}
                            })
                            if call_tool_response:
                                print("INFO: 'tools/call' for 'list-databases' completed.")
                            else:
                                print("ERROR: 'tools/call' for 'list-databases' failed to get a valid response.")
                            
                            # All POST tests done, we can now break from the SSE loop
                            print("All client-side POST tests within SSE session are complete.")
                            return # Exit run_tests, which will close the SSE 'with' block

                    except json.JSONDecodeError:
                        print(f"ERROR: Could not decode JSON from mcp-session-id data: {data_content}")
                    except Exception as e_inner:
                        print(f"ERROR processing mcp-session-id event: {e_inner}")
                    # Break after attempting to process the session ID event, whether successful or not for this iteration
                    # to avoid getting stuck if other events come first or format is off.
                    # If session_id_from_sse is set, the outer logic handles it.
                    if session_id_from_sse: # Exit loop once session ID is processed
                        break 
                elif line.startswith('data:'): # Log other data events if they appear before our target
                    print(f"SSE Data (other event while searching: {current_event_name if current_event_name else 'unnamed'}): {line[len('data:'):].strip()}")
                    current_event_name = None
            
            # Fallback if loop finished without getting session ID
            if not session_id_from_sse:
                print("ERROR: Did not receive mcp-session-id event after iterating available SSE lines.")

    except requests.exceptions.RequestException as e:
        print(f"ERROR: SSE connection establishment failed: {e}")
    except Exception as e_outer:
        print(f"ERROR: An unexpected error occurred in run_tests: {e_outer}")
    finally:
        print("Exiting run_tests. SSE connection (if open) will be closed by 'with' statement.")


if __name__ == "__main__":
    run_tests()
    print("\nTest script finished.")