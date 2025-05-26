import requests
import json
import time
import uuid # For dummy API keys
import os

from dotenv import load_dotenv
load_dotenv()

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
        "Content-Type": "application/json",
        "X-MCP-Session-ID": session_id
    }
    payload_dict = {
        "jsonrpc": "2.0",
        "id": next_request_id(),
        "method": method,
    }
    if params is not None:
        payload_dict["params"] = params

    payload_str = json.dumps(payload_dict)

    print(f"\n--- Sending MCP Request ---")
    print(f"URL: {MCP_ENDPOINT}")
    print(f"Method: {method}")
    print(f"Headers: {json.dumps(headers)}")
    print(f"Payload String: {payload_str}")

    try:
        response = requests.post(MCP_ENDPOINT, data=payload_str, headers=headers, timeout=15)
        print(f"Response Status: {response.status_code}")

        # Handle 202 "Accepted" specifically for 'initialize'
        if method == "initialize" and response.status_code == 202 and "Accepted" in response.text:
            print("INFO: 'initialize' call returned 202 Accepted. Assuming server processed it for session setup.")
            print(f"Raw text from 202 response: {response.text}")
            # Return a synthetic object indicating it was accepted, so the script can continue
            return {"jsonrpc": "2.0", "id": payload_dict.get("id"), "result_type": "acknowledged_202"}

        if response.text:
            try:
                response_data = response.json()
                print(f"Response JSON: {json.dumps(response_data, indent=2)}")
                return response_data
            except json.JSONDecodeError:
                print(f"ERROR: Could not decode JSON from response. Raw text: {response.text}")
                return {"error_type": "Non-JSON response", "status_code": response.status_code, "text": response.text}
        else:
            print("WARNING: Empty response from server.")
            return {"error_type": "Empty response", "status_code": response.status_code}
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
                            notion_api_key = os.environ.get("NOTION_API_KEY")
                            if not notion_api_key:
                                print("ERROR: NOTION_API_KEY not set in environment. Please set it in your .env or environment variables.")
                                return
                            print(f"Using NOTION_API_KEY from environment for initialize: {notion_api_key[:6]}...{notion_api_key[-4:]}")
                            initialize_params = {
                                "protocolVersion": "2024-11-05",
                                "clientInfo": {"name": "python-test-client", "version": "0.1.0"},
                                "capabilities": {},
                                "initializationOptions": {"notionApiKey": notion_api_key}
                            }
                            init_response = send_mcp_post_request(session_id_from_sse, "initialize", initialize_params)
                            # Accept either a normal result or our synthetic 202-acknowledged response
                            if init_response and (init_response.get("result_type") == "acknowledged_202" or "result" in init_response):
                                print("SUCCESS: 'initialize' call was acknowledged by the server or returned a result.")
                                # Crucially, check server logs to see if the API key was actually stored for this session.
                            else:
                                print("ERROR: 'initialize' call failed or server did not acknowledge as expected. Test ending.")
                                # You might still want to return here if initialize is critical for subsequent steps
                                # depending on strictness, but for this test let's try to proceed.
                                # return 

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
