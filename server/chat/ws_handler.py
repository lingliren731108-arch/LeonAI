import json
import os
import asyncio
import threading
from pathlib import Path
from fastapi import WebSocket, WebSocketDisconnect
from server.chat.context_builder import ContextBuilder
from server.chat.claude_client import ClaudeClient
from server.chat.tool_executor import ToolExecutor


class ChatWebSocketHandler:
    def __init__(self, workspace_path: str = "workspace/leon") -> None:
        self.workspace_path = Path(workspace_path)
        self.context_builder = ContextBuilder(workspace_path)
        self.tool_executor = ToolExecutor(workspace_path)
        self.claude_client = ClaudeClient()

    def _load_system_prompt(self, project_context_md: str) -> str:
        """Loads system-prompt.md and appends the project context to it."""
        prompt_path = Path("prompts/system-prompt.md")
        base_prompt = ""
        if prompt_path.exists():
            try:
                base_prompt = prompt_path.read_text(encoding='utf-8')
            except Exception:
                pass
        
        if not base_prompt:
            # Basic fallback prompt
            base_prompt = (
                "You are Leon AI, an experienced developer coding assistant and software engineer. "
                "You help users write, run, test, and debug code, and manage their project workspace.\n"
                "Please follow the user instructions exactly, using your available file and terminal tools."
            )

        # Merge with gathered project structure context
        return f"{base_prompt}\n\n{project_context_md}"

    async def handle_connection(self, websocket: WebSocket) -> None:
        await websocket.accept()
        print("WebSocket client connected.")

        active_task = None

        async def run_agent_loop(data):
            try:
                user_messages = data.get("messages", [])
                selection_context = data.get("selection_context", {})
                associated_file = data.get("associated_file")

                # 2. Compile active workspace context and selection
                context_md = self.context_builder.build_context(selection_context)

                # Load and append associated file context if present
                if associated_file:
                    try:
                        # If path is relative, resolve relative to self.workspace_path
                        file_path = Path(associated_file)
                        if not file_path.is_absolute() and not associated_file.replace('\\', '/').startswith("workspace/leon"):
                            file_path = self.workspace_path / associated_file
                        
                        # Security check: must be inside workspace/leon/
                        resolved = file_path.resolve()
                        if str(resolved).startswith(str(self.workspace_path.resolve())) and file_path.is_file():
                            if file_path.suffix.lower() == '.docx':
                                from server.chat.docx_parser import extract_docx_text
                                file_content = extract_docx_text(file_path)
                            else:
                                file_content = file_path.read_text(encoding='utf-8')
                            
                            if len(file_content) > 500000:
                                file_content = file_content[:500000] + "\n... [Content Truncated due to size] ..."
                            
                            # Inject path, contents, and explicit instructions for the AI model
                            context_md += (
                                f"\n\n### User Designated Target File for Modification\n"
                                f"Path: `{associated_file}`\n"
                                f"Content:\n```\n{file_content}\n```\n"
                                f"[INSTRUCTION] The user has explicitly designated the file '{associated_file}' "
                                f"above as the primary target for their modification request. You should prioritize "
                                f"reading/editing this file using your tools (such as edit_screen or write_workspace_file) "
                                f"to fulfill the user request.\n"
                            )
                            print(f"DEBUG: Pinned file received and successfully loaded: {associated_file}")
                        else:
                            print(f"Warning: Associated file path check failed for '{associated_file}' (resolved: '{resolved}')")
                    except Exception as e:
                        print(f"Warning: Failed to read associated file '{associated_file}': {e}")

                system_prompt = self._load_system_prompt(context_md)

                # Initialize local message history for the agentic tool call loop
                # We start with copy of history to avoid mutating user message state
                history = list(user_messages)

                # 3. Agent Tool execution loop
                loop_count = 0
                max_loops = 10  # Prevent infinite tool call loops
                
                while loop_count < max_loops:
                    loop_count += 1
                    
                    # Call Claude client stream
                    text_delta_accumulated = ""
                    current_tool_calls = []

                    # Run stream in background thread to prevent blocking the event loop
                    q = asyncio.Queue()
                    loop = asyncio.get_running_loop()

                    def producer():
                        try:
                            for event in self.claude_client.chat_stream(history, system_prompt):
                                loop.call_soon_threadsafe(q.put_nowait, event)
                        except Exception as e:
                            loop.call_soon_threadsafe(q.put_nowait, {"type": "error", "content": str(e)})
                        finally:
                            loop.call_soon_threadsafe(q.put_nowait, None)

                    threading.Thread(target=producer, daemon=True).start()

                    while True:
                        event = await q.get()
                        if event is None:
                            break

                        if event["type"] == "text":
                            text_delta_accumulated += event["content"]
                            await websocket.send_text(json.dumps({
                                "type": "text",
                                "content": event["content"]
                            }))
                        elif event["type"] == "tool_call":
                            current_tool_calls.append(event)
                        elif event["type"] == "error":
                            await websocket.send_text(json.dumps({
                                "type": "error",
                                "content": event["content"]
                            }))

                    # If Claude wanted to call tools
                    if current_tool_calls:
                        # Append assistant message with tool calls to history
                        tool_calls_mapped = []
                        for tc in current_tool_calls:
                            tool_calls_mapped.append({
                                "id": tc["id"],
                                "name": tc["name"],
                                "args": tc["args"]
                            })
                        
                        history.append({
                            "role": "assistant",
                            "content": text_delta_accumulated,
                            "tool_calls": tool_calls_mapped
                        })

                        # Execute each tool in sequence
                        for tc in current_tool_calls:
                            await websocket.send_text(json.dumps({
                                "type": "tool_start",
                                "id": tc["id"],
                                "name": tc["name"],
                                "args": tc["args"]
                            }))

                            # Run tool in background thread to prevent blocking the event loop
                            result = await asyncio.to_thread(self.tool_executor.execute_tool, tc["name"], tc["args"])

                            await websocket.send_text(json.dumps({
                                "type": "tool_end",
                                "id": tc["id"],
                                "name": tc["name"],
                                "result": result
                            }))

                            # Append tool response to message history
                            history.append({
                                "role": "tool",
                                "tool_call_id": tc["id"],
                                "name": tc["name"],
                                "content": result
                            })

                        # Trigger frontend refresh of workspace files on tool usage
                        await websocket.send_text(json.dumps({"type": "refresh"}))
                        
                        # Re-compile context so the next tool call gets the updated directory structure!
                        context_md = self.context_builder.build_context(selection_context)
                        system_prompt = self._load_system_prompt(context_md)
                        
                        # Continue loop to send tool output back to model
                        continue
                    
                    else:
                        # No more tool calls, assistant has replied text, loop is done
                        break

                # Send completed indicator to React
                await websocket.send_text(json.dumps({"type": "done"}))

            except asyncio.CancelledError:
                print("Agent execution loop cancelled by client.")
                try:
                    await websocket.send_text(json.dumps({"type": "done"}))
                except Exception:
                    pass
                raise
            except Exception as e:
                print(f"Agent execution loop error: {e}")
                try:
                    await websocket.send_text(json.dumps({
                        "type": "error",
                        "content": f"Agent processing error: {e}"
                    }))
                except Exception:
                    pass

        try:
            while True:
                data_str = await websocket.receive_text()
                data = json.loads(data_str)
                
                msg_type = data.get("type")
                if msg_type == "stop":
                    if active_task and not active_task.done():
                        print("Stopping agent loop execution...")
                        active_task.cancel()
                    continue

                # For new chat requests, cancel any currently running task
                if active_task and not active_task.done():
                    active_task.cancel()
                    try:
                        await active_task
                    except asyncio.CancelledError:
                        pass

                active_task = asyncio.create_task(run_agent_loop(data))

        except WebSocketDisconnect:
            print("WebSocket client disconnected.")
            if active_task and not active_task.done():
                active_task.cancel()
        except Exception as e:
            print(f"WebSocket execution error: {e}")
            if active_task and not active_task.done():
                active_task.cancel()
            try:
                await websocket.send_text(json.dumps({
                    "type": "error",
                    "content": f"Server processing error: {e}"
                }))
            except Exception:
                pass
