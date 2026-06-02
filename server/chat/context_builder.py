import json
import os
import re
from pathlib import Path

class ContextBuilder:
    def __init__(self, workspace_path: str = "workspace/leon") -> None:
        self.workspace_path = Path(workspace_path)

    def get_directory_tree(self) -> str:
        """Generates a text representation of the workspace directory tree."""
        if not self.workspace_path.exists():
            return "Workspace is empty or has not been initialized."

        lines = []
        def _walk(path: Path, prefix: str = "") -> None:
            # Skip exports to keep tree clean
            if path.name == "exports":
                return
            
            try:
                entries = sorted(list(path.iterdir()), key=lambda e: (not e.is_dir(), e.name.lower()))
            except PermissionError:
                return

            for i, entry in enumerate(entries):
                is_last = (i == len(entries) - 1)
                connector = "└── " if is_last else "├── "
                lines.append(f"{prefix}{connector}{entry.name}{'/' if entry.is_dir() else ''}")
                
                if entry.is_dir():
                    new_prefix = prefix + ("    " if is_last else "│   ")
                    _walk(entry, new_prefix)

        lines.append(f"workspace/leon/{self.workspace_path.name}/")
        _walk(self.workspace_path)
        return "\n".join(lines)

    def build_context(self, selection_context: dict | None = None) -> str:
        """Compiles the full context to inject into the Claude system/user prompt."""
        self.workspace_path.mkdir(parents=True, exist_ok=True)
        
        dir_tree = self.get_directory_tree()

        context_str = f"""
## Current Project Context

### Project Directory Structure
```text
{dir_tree}
```
"""
        if selection_context:
            context_str += f"\n### Current User Canvas Selection Context\n```json\n{json.dumps(selection_context, indent=2, ensure_ascii=False)}\n```\n"

        return context_str
