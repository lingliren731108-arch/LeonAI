import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any, Dict, List, Tuple


class ToolExecutionError(Exception):
    pass


class ToolExecutor:
    def __init__(self, workspace_path: str = "workspace/leon") -> None:
        self.workspace_path = Path(workspace_path)
        self.scripts_path = Path("scripts")
 
    def _resolve_argument_path(self, path_str: Any) -> Any:
        if not isinstance(path_str, str):
            return path_str
        normalized = path_str.replace('\\', '/')
        username = self.workspace_path.name
        
        if "workspace/leon/" in normalized:
            idx = normalized.find("workspace/leon/")
            suffix = normalized[idx + len("workspace/leon/"):]
            while suffix.startswith(username + "/"):
                suffix = suffix[len(username + "/"):]
            if suffix == username:
                suffix = ""
            return (self.workspace_path / suffix).as_posix()
        elif normalized == "workspace/leon":
            return self.workspace_path.as_posix()
            
        workspace_leon_abs = self.workspace_path.parent.as_posix()
        if normalized.startswith(workspace_leon_abs + "/"):
            suffix = normalized[len(workspace_leon_abs + "/"):]
            while suffix.startswith(username + "/"):
                suffix = suffix[len(username + "/"):]
            if suffix == username:
                suffix = ""
            return (self.workspace_path / suffix).as_posix()
            
        return path_str
 
    def run_script(self, script_name: str, args: List[str], stdin_content: str | None = None) -> Tuple[int, str, str]:
        """Runs a python script in a subprocess using the current interpreter."""
        script_path = self.scripts_path / script_name
        if not script_path.exists():
            raise ToolExecutionError(f"Script '{script_name}' not found in scripts folder.")

        cmd = [sys.executable, "-X", "utf8", str(script_path)] + args
        
        # Use UTF-8 encoding for standard streams and pass dynamic user workspace dir
        env = dict(os.environ)
        env["PYTHONIOENCODING"] = "utf-8"
        env["WORKSPACE_DIR"] = str(self.workspace_path)
        try:
            process = subprocess.Popen(
                cmd,
                stdin=subprocess.PIPE if stdin_content else None,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                encoding='utf-8',
                env=env
            )
            stdout, stderr = process.communicate(input=stdin_content)
            return process.returncode, stdout, stderr
        except Exception as e:
            raise ToolExecutionError(f"Failed to execute subprocess for script {script_name}: {e}")

    def execute_tool(self, name: str, args: Dict[str, Any]) -> Dict[str, Any]:
        """Maps and executes the tool request."""
        try:
            if name == "read_workspace_file":
                return self._read_workspace_file(args)
            elif name == "write_workspace_file":
                return self._write_workspace_file(args)
            elif name == "list_dir":
                return self._list_dir(args)
            elif name == "create_folder":
                return self._create_folder(args)
            elif name == "run_terminal_command":
                return self._run_terminal_command(args)
            else:
                return {"success": False, "error": f"Unknown tool name: {name}"}
        except Exception as e:
            return {"success": False, "error": str(e)}
    def _read_workspace_file(self, args: Dict[str, Any]) -> Dict[str, Any]:
        path_str = args.get("path", "")
        path = Path(path_str)
        
        # If relative and doesn't start with workspace/leon or prompts, prepend self.workspace_path
        if not path.is_absolute():
            parts = path.parts
            if not (len(parts) > 0 and parts[0] in ("workspace", "prompts")):
                path = self.workspace_path / path

        # Security check: limit to self.workspace_path or prompts
        is_safe = False
        try:
            resolved = path.resolve()
            if str(resolved).startswith(str(self.workspace_path.resolve())) or \
               str(resolved).startswith(str(Path("prompts").resolve())):
                is_safe = True
        except Exception:
            pass

        if not is_safe:
            return {"success": False, "error": f"Access denied. Path '{path_str}' must be within your workspace or prompts directories."}

        if not path.exists():
            return {"success": False, "error": f"File '{path_str}' does not exist."}

        try:
            if path.suffix.lower() == '.docx':
                from server.chat.docx_parser import extract_docx_text
                content = extract_docx_text(path)
            else:
                content = path.read_text(encoding='utf-8')
            return {"success": True, "content": content}
        except Exception as e:
            return {"success": False, "error": f"Failed to read file: {e}"}

    def _write_workspace_file(self, args: Dict[str, Any]) -> Dict[str, Any]:
        path_str = args.get("path", "")
        content = args.get("content", "")
        path = Path(path_str)

        # If relative and doesn't start with workspace/leon, prepend self.workspace_path
        if not path.is_absolute():
            parts = path.parts
            # If it starts with workspace/leon but doesn't have the user segment, we force prepend user path
            if len(parts) > 1 and parts[0] == "workspace" and parts[1] == "leon":
                # Check if it contains username, if not prepend username folder
                user_segment = self.workspace_path.name
                if len(parts) > 2 and parts[2] == user_segment:
                    pass
                else:
                    # Replace workspace/leon with self.workspace_path
                    path = self.workspace_path / Path(*parts[2:])
            else:
                path = self.workspace_path / path

        # Security check: limit to self.workspace_path
        is_safe = False
        try:
            resolved = path.resolve()
            if not resolved.exists():
                resolved = path.parent.resolve()
            if str(resolved).startswith(str(self.workspace_path.resolve())):
                is_safe = True
        except Exception:
            pass

        if not is_safe:
            return {"success": False, "error": f"Access denied. Target path '{path_str}' must be inside your workspace."}

        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(content, encoding='utf-8')
            return {"success": True, "message": f"Successfully wrote file to {path_str}"}
        except Exception as e:
            return {"success": False, "error": f"Failed to write file: {e}"}

    def _list_dir(self, args: Dict[str, Any]) -> Dict[str, Any]:
        path_str = args.get("path", "")
        target_path = self.workspace_path
        if path_str:
            target_path = self.workspace_path / path_str.replace('\\', '/').strip('/')
            
        is_safe = False
        try:
            resolved = target_path.resolve()
            if str(resolved).startswith(str(self.workspace_path.resolve())):
                is_safe = True
        except Exception:
            pass
            
        if not is_safe:
            return {"success": False, "error": f"Access denied. Path must be inside your workspace."}
            
        if not target_path.exists():
            return {"success": False, "error": f"Directory '{path_str}' does not exist."}
            
        if not target_path.is_dir():
            return {"success": False, "error": f"Path '{path_str}' is not a directory."}
            
        try:
            entries = []
            for entry in sorted(list(target_path.iterdir()), key=lambda e: (not e.is_dir(), e.name.lower())):
                if entry.name.startswith('.') or entry.name == "exports":
                    continue
                entries.append({
                    "name": entry.name,
                    "is_dir": entry.is_dir(),
                    "size": entry.stat().st_size if entry.is_file() else None
                })
            return {"success": True, "entries": entries}
        except Exception as e:
            return {"success": False, "error": f"Failed to list directory: {e}"}

    def _create_folder(self, args: Dict[str, Any]) -> Dict[str, Any]:
        path_str = args.get("path", "")
        if not path_str:
            return {"success": False, "error": "Path cannot be empty."}
            
        target_path = self.workspace_path / path_str.replace('\\', '/').strip('/')
        is_safe = False
        try:
            resolved = target_path.resolve() if target_path.exists() else target_path.parent.resolve()
            if str(resolved).startswith(str(self.workspace_path.resolve())):
                is_safe = True
        except Exception:
            pass
            
        if not is_safe:
            return {"success": False, "error": f"Access denied. Path must be inside your workspace."}
            
        try:
            target_path.mkdir(parents=True, exist_ok=True)
            return {"success": True, "message": f"Successfully created folder: {path_str}"}
        except Exception as e:
            return {"success": False, "error": f"Failed to create folder: {e}"}

    def _run_terminal_command(self, args: Dict[str, Any]) -> Dict[str, Any]:
        import subprocess
        command_str = args.get("command", "").strip()
        if not command_str:
            return {"success": False, "error": "Command is empty."}
            
        cmd_lower = command_str.lower()
        blocked_patterns = ["..", "rmdir /s", "del /f /s /q c:", "format", "shutdown", "reboot", "taskkill", "killall"]
        for pattern in blocked_patterns:
            if pattern in cmd_lower:
                return {"success": False, "error": f"Command blocked: '{pattern}' is not allowed for security reasons."}
                
        try:
            env = dict(os.environ)
            env["WORKSPACE_DIR"] = str(self.workspace_path)
            env["PYTHONIOENCODING"] = "utf-8"
            
            process = subprocess.run(
                command_str,
                shell=True,
                cwd=str(self.workspace_path),
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                encoding='utf-8',
                timeout=30,
                env=env
            )
            return {
                "success": process.returncode == 0,
                "code": process.returncode,
                "stdout": process.stdout,
                "stderr": process.stderr
            }
        except subprocess.TimeoutExpired:
            return {"success": False, "error": "Command execution timed out (limit: 30 seconds)."}
        except Exception as e:
            return {"success": False, "error": f"Execution error: {e}"}

