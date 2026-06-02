import json
import os
import sys
from pathlib import Path
from typing import Any, Dict, Generator, List, Tuple
from openai import OpenAI
from anthropic import Anthropic

# Get tools schema in a generic format
TOOLS_SCHEMA = [
    {
        "name": "read_workspace_file",
        "description": "Read file contents from the workspace folder.",
        "parameters": {
            "type": "object",
            "properties": {
                "path": {"type": "string", "description": "Relative file path from the workspace root."}
            },
            "required": ["path"]
        }
    },
    {
        "name": "write_workspace_file",
        "description": "Write file content directly into the workspace.",
        "parameters": {
            "type": "object",
            "properties": {
                "path": {"type": "string", "description": "Target relative file path in the workspace."},
                "content": {"type": "string", "description": "File text/code content."}
            },
            "required": ["path", "content"]
        }
    },
    {
        "name": "list_dir",
        "description": "List all files and folders in a specified subdirectory inside the workspace.",
        "parameters": {
            "type": "object",
            "properties": {
                "path": {"type": "string", "description": "Relative directory path. Use empty string '' for the root workspace."}
            },
            "required": ["path"]
        }
    },
    {
        "name": "create_folder",
        "description": "Create a new folder in the workspace.",
        "parameters": {
            "type": "object",
            "properties": {
                "path": {"type": "string", "description": "Relative directory path to create."}
            },
            "required": ["path"]
        }
    },
    {
        "name": "run_terminal_command",
        "description": "Execute a terminal shell command (like compiling, running scripts, or build processes) inside the workspace.",
        "parameters": {
            "type": "object",
            "properties": {
                "command": {"type": "string", "description": "The exact shell command to run (e.g. 'python run.py', 'npm run build')."}
            },
            "required": ["command"]
        }
    }
]


class ClaudeClient:
    def __init__(self) -> None:
        self.api_provider = None
        self.openai_client = None
        self.anthropic_client = None
        
        # Configure API provider based on env variables
        anthropic_key = os.getenv("ANTHROPIC_API_KEY")
        openai_key = os.getenv("OPENAI_API_KEY")
        
        # Filter placeholders
        if anthropic_key and ("your_" in anthropic_key or anthropic_key.strip() == ""):
            anthropic_key = None
        if openai_key and ("your_" in openai_key or openai_key.strip() == ""):
            openai_key = None
            
        if anthropic_key:
            self.api_provider = "anthropic"
            base_url = os.getenv("ANTHROPIC_BASE_URL")
            self.anthropic_client = Anthropic(api_key=anthropic_key, base_url=base_url)
        elif openai_key:
            self.api_provider = "openai"
            base_url = os.getenv("OPENAI_BASE_URL")
            self.openai_client = OpenAI(api_key=openai_key, base_url=base_url)
        else:
            # Fallback configuration warning
            print("Warning: Neither ANTHROPIC_API_KEY nor OPENAI_API_KEY is configured in .env", file=sys.stderr)

    def _get_anthropic_tools(self) -> List[Dict[str, Any]]:
        anth_tools = []
        for tool in TOOLS_SCHEMA:
            anth_tools.append({
                "name": tool["name"],
                "description": tool["description"],
                "input_schema": tool["parameters"]
            })
        return anth_tools

    def _get_openai_tools(self) -> List[Dict[str, Any]]:
        openai_tools = []
        for tool in TOOLS_SCHEMA:
            openai_tools.append({
                "type": "function",
                "function": {
                    "name": tool["name"],
                    "description": tool["description"],
                    "parameters": tool["parameters"]
                }
            })
        return openai_tools

    def chat_stream(
        self,
        messages: List[Dict[str, Any]],
        system_prompt: str,
        temperature: float = 0.2
    ) -> Generator[Dict[str, Any], None, None]:
        """Streams responses from Anthropic or OpenAI API.

        Yields dictionaries in format:
        - {"type": "text", "content": "delta_text"}
        - {"type": "tool_call", "name": "tool_name", "id": "call_id", "args": {...}}
        """
        if not self.api_provider:
            yield {"type": "error", "content": "API Key not configured. Please configure ANTHROPIC_API_KEY or OPENAI_API_KEY in .env."}
            return

        if self.api_provider == "anthropic":
            yield from self._stream_anthropic(messages, system_prompt, temperature)
        else:
            yield from self._stream_openai(messages, system_prompt, temperature)

    def _stream_anthropic(
        self,
        messages: List[Dict[str, Any]],
        system_prompt: str,
        temperature: float
    ) -> Generator[Dict[str, Any], None, None]:
        # Map generic message format to Anthropic structure
        anth_messages = []
        for msg in messages:
            # Skip system messages in messages list for Anthropic, system goes to top-level parameter
            if msg["role"] == "system":
                continue
            
            # Map Anthropic message fields
            if msg["role"] == "assistant" and "tool_calls" in msg:
                content = []
                if msg.get("content"):
                    content.append({"type": "text", "text": msg["content"]})
                for tc in msg["tool_calls"]:
                    content.append({
                        "type": "tool_use",
                        "id": tc["id"],
                        "name": tc["name"],
                        "input": tc["args"]
                    })
                anth_messages.append({"role": "assistant", "content": content})
            elif msg["role"] == "tool":
                anth_messages.append({
                    "role": "user",
                    "content": [
                        {
                            "type": "tool_result",
                            "tool_use_id": msg["tool_call_id"],
                            "content": json.dumps(msg["content"]) if not isinstance(msg["content"], str) else msg["content"]
                        }
                    ]
                })
            else:
                anth_messages.append({"role": msg["role"], "content": msg["content"]})

        model = os.getenv("ANTHROPIC_MODEL", "claude-3-5-sonnet-20241022")
        tools = self._get_anthropic_tools()

        try:
            with self.anthropic_client.messages.stream(
                model=model,
                max_tokens=8192,
                system=system_prompt,
                messages=anth_messages,
                tools=tools,
                temperature=temperature
            ) as stream:
                # Accumulators for tool use
                tool_uses = {}
                
                for event in stream:
                    if event.type == "content_block_start":
                        if event.content_block.type == "tool_use":
                            tool_uses[event.index] = {
                                "id": event.content_block.id,
                                "name": event.content_block.name,
                                "input_str": ""
                            }
                    elif event.type == "content_block_delta":
                        if event.delta.type == "text_delta":
                            yield {"type": "text", "content": event.delta.text}
                        elif event.delta.type == "input_json_delta":
                            tool_uses[event.index]["input_str"] += event.delta.partial_json
                    elif event.type == "content_block_stop":
                        if event.index in tool_uses:
                            tu = tool_uses[event.index]
                            try:
                                args = json.loads(tu["input_str"]) if tu["input_str"] else {}
                            except Exception:
                                args = {}
                            yield {
                                "type": "tool_call",
                                "name": tu["name"],
                                "id": tu["id"],
                                "args": args
                            }
        except Exception as e:
            yield {"type": "error", "content": f"Anthropic API Streaming Error: {e}"}

    def _stream_openai(
        self,
        messages: List[Dict[str, Any]],
        system_prompt: str,
        temperature: float
    ) -> Generator[Dict[str, Any], None, None]:
        # Merge system prompt to messages for OpenAI
        openai_messages = [{"role": "system", "content": system_prompt}]
        
        for msg in messages:
            if msg["role"] == "system":
                continue
            
            # Map generic messages to OpenAI format
            if msg["role"] == "assistant" and "tool_calls" in msg:
                openai_msg = {
                    "role": "assistant",
                    "content": msg.get("content"),
                    "tool_calls": []
                }
                for tc in msg["tool_calls"]:
                    openai_msg["tool_calls"].append({
                        "id": tc["id"],
                        "type": "function",
                        "function": {
                            "name": tc["name"],
                            "arguments": json.dumps(tc["args"])
                        }
                    })
                openai_messages.append(openai_msg)
            elif msg["role"] == "tool":
                openai_messages.append({
                    "role": "tool",
                    "tool_call_id": msg["tool_call_id"],
                    "content": json.dumps(msg["content"]) if not isinstance(msg["content"], str) else msg["content"]
                })
            else:
                openai_messages.append({"role": msg["role"], "content": msg["content"]})

        model = os.getenv("OPENAI_MODEL", "gpt-4o")
        tools = self._get_openai_tools()

        try:
            response = self.openai_client.chat.completions.create(
                model=model,
                messages=openai_messages,
                tools=tools,
                temperature=temperature,
                stream=True
            )

            # Tool call accumulators
            tool_calls_acc = {}

            for chunk in response:
                if not chunk.choices:
                    continue
                delta = chunk.choices[0].delta
                
                # Check for content delta
                if delta.content:
                    yield {"type": "text", "content": delta.content}

                # Check for tool call delta
                if delta.tool_calls:
                    for tc in delta.tool_calls:
                        idx = tc.index
                        if idx not in tool_calls_acc:
                            tool_calls_acc[idx] = {
                                "id": tc.id,
                                "name": tc.function.name if tc.function and tc.function.name else "",
                                "args_str": ""
                            }
                        if tc.id:
                            tool_calls_acc[idx]["id"] = tc.id
                        if tc.function and tc.function.name:
                            tool_calls_acc[idx]["name"] = tc.function.name
                        if tc.function and tc.function.arguments:
                            tool_calls_acc[idx]["args_str"] += tc.function.arguments

            # Yield finished tool calls
            for idx, tc in tool_calls_acc.items():
                try:
                    args = json.loads(tc["args_str"]) if tc["args_str"] else {}
                except Exception:
                    args = {}
                yield {
                    "type": "tool_call",
                    "name": tc["name"],
                    "id": tc["id"],
                    "args": args
                }
        except Exception as e:
            yield {"type": "error", "content": f"OpenAI API Streaming Error: {e}"}
