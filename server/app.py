import json
import os
import sys
import base64
import mimetypes
import shutil
import zipfile
from pathlib import Path
from typing import Optional
from fastapi import FastAPI, WebSocket, HTTPException, Query, Header, File, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel

# Add workspace root to python path for imports
root_path = Path(__file__).parent.parent
sys.path.insert(0, str(root_path))

from dotenv import load_dotenv
load_dotenv(root_path / ".env")

from server.chat.ws_handler import ChatWebSocketHandler
from server.chat.context_builder import ContextBuilder
from server.chat.tool_executor import ToolExecutor
from server.db import init_db, get_user, list_users, create_user, update_user, delete_user

app = FastAPI(title="Leon AI Backend Server")

# Enable CORS for frontend Vite server
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Startup DB initialization
@app.on_event("startup")
def startup_event():
    try:
        init_db()
    except Exception as e:
        print(f"❌ Failed to initialize database: {e}", file=sys.stderr)

# Helper to ensure user workspace directories exist and copy templates
def ensure_user_workspace_exists(username: str) -> Path:
    # Sanitize username to prevent directory traversal
    safe_username = "".join(c for c in username if c.isalnum() or c in ("-", "_"))
    if not safe_username:
        raise ValueError("Invalid username")
        
    user_dir = root_path / "workspace" / "leon" / safe_username
    
    # If the user directory doesn't exist, we initialize it
    if not user_dir.exists():
        user_dir.mkdir(parents=True, exist_ok=True)
                        
    return user_dir

def get_user_workspace_from_request(x_user: Optional[str] = Header(None), user: Optional[str] = Query(None)) -> Path:
    username = x_user or user
    if not username:
        raise HTTPException(status_code=401, detail="User authentication required (X-User header or user query param)")
    try:
        return ensure_user_workspace_exists(username)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid username")


class FileWriteRequest(BaseModel):
    path: str
    content: str


class LoginRequest(BaseModel):
    username: str
    password: str


class UserCreateRequest(BaseModel):
    username: str
    password: str
    role: str = "user"


class UserUpdateRequest(BaseModel):
    username: str
    password: str
    role: str


class FolderCreateRequest(BaseModel):
    path: str


class RenameRequest(BaseModel):
    old_path: str
    new_path: str


class TerminalExecuteRequest(BaseModel):
    command: str


def get_tree_nodes(path: Path, root_path: Path) -> list:
    """Helper to build recursive directory tree nodes."""
    nodes = []
    if not path.exists():
        return nodes
    
    try:
        for entry in sorted(list(path.iterdir()), key=lambda e: (not e.is_dir(), e.name.lower())):
            # Skip export ZIP archives and hidden files
            if entry.name.startswith(".") or entry.name == "exports":
                continue
            
            rel_path = entry.relative_to(root_path).as_posix()
            node = {
                "name": entry.name,
                "path": rel_path,
                "is_dir": entry.is_dir()
            }
            if entry.is_dir():
                node["children"] = get_tree_nodes(entry, root_path)
            nodes.append(node)
    except PermissionError:
        pass
    return nodes


# --- Auth & User Management API ---

@app.post("/api/auth/login")
def login(req: LoginRequest):
    user = get_user(req.username)
    if not user or user["password"] != req.password:
        raise HTTPException(status_code=401, detail="Invalid username or password")
    return JSONResponse(content={
        "success": True,
        "username": user["username"],
        "role": user["role"]
    })


@app.get("/api/admin/users")
def get_users_list(x_user: Optional[str] = Header(None)):
    curr_user = get_user(x_user)
    if not curr_user or curr_user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Access denied. Admin only.")
    users = list_users()
    for u in users:
        if u.get("created_at"):
            u["created_at"] = u["created_at"].isoformat()
    return JSONResponse(content=users)


@app.post("/api/admin/users")
def add_new_user(req: UserCreateRequest, x_user: Optional[str] = Header(None)):
    curr_user = get_user(x_user)
    if not curr_user or curr_user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Access denied. Admin only.")
    try:
        create_user(req.username, req.password, req.role)
        return JSONResponse(content={"success": True, "message": "User created successfully"})
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.put("/api/admin/users/{user_id}")
def update_user_details(user_id: int, req: UserUpdateRequest, x_user: Optional[str] = Header(None)):
    curr_user = get_user(x_user)
    if not curr_user or curr_user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Access denied. Admin only.")
    try:
        update_user(user_id, req.username, req.password, req.role)
        return JSONResponse(content={"success": True, "message": "User updated successfully"})
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/api/admin/users/{user_id}")
def delete_user_account(user_id: int, x_user: Optional[str] = Header(None)):
    curr_user = get_user(x_user)
    if not curr_user or curr_user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Access denied. Admin only.")
    try:
        delete_user(user_id)
        return JSONResponse(content={"success": True, "message": "User deleted successfully"})
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/workspace/upload")
async def upload_file(
    file: UploadFile = File(...),
    folder: Optional[str] = Query("", description="Target subfolder"),
    x_user: Optional[str] = Header(None),
    user: Optional[str] = Query(None)
):
    """Uploads any file into the specified folder in the user's workspace."""
    user_dir = get_user_workspace_from_request(x_user, user)
    
    target_dir = user_dir
    if folder:
        normalized_folder = folder.replace('\\', '/').strip('/')
        target_dir = user_dir / normalized_folder

    file_path = target_dir / file.filename
    try:
        target_dir.mkdir(parents=True, exist_ok=True)
        # Verify resolved path is within workspace (traversal defense)
        resolved_parent = file_path.parent.resolve()
        if not str(resolved_parent).startswith(str(user_dir.resolve())):
            raise HTTPException(status_code=403, detail="Access denied. Path must be inside your workspace.")
            
        with open(file_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
            
        rel_path = file_path.relative_to(user_dir).as_posix()
        return JSONResponse(content={"success": True, "filename": file.filename, "path": rel_path})
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to upload file: {e}")


@app.post("/api/workspace/folder")
def create_folder(
    req: FolderCreateRequest,
    x_user: Optional[str] = Header(None),
    user: Optional[str] = Query(None)
):
    """Creates a folder in the user's workspace."""
    user_dir = get_user_workspace_from_request(x_user, user)
    folder_path = user_dir / req.path
    try:
        resolved = folder_path.resolve() if folder_path.exists() else folder_path.parent.resolve()
        if not str(resolved).startswith(str(user_dir.resolve())):
            raise HTTPException(status_code=403, detail="Access denied. Path must be inside your workspace.")
            
        folder_path.mkdir(parents=True, exist_ok=True)
        return JSONResponse(content={"success": True, "message": f"Folder created successfully at {req.path}"})
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to create folder: {e}")


@app.post("/api/workspace/rename")
def rename_path(
    req: RenameRequest,
    x_user: Optional[str] = Header(None),
    user: Optional[str] = Query(None)
):
    """Renames a file or folder in the user's workspace."""
    user_dir = get_user_workspace_from_request(x_user, user)
    old_file = user_dir / req.old_path
    new_file = user_dir / req.new_path
    
    try:
        resolved_old = old_file.resolve()
        resolved_new_parent = new_file.parent.resolve()
        
        if not str(resolved_old).startswith(str(user_dir.resolve())) or \
           not str(resolved_new_parent).startswith(str(user_dir.resolve())):
            raise HTTPException(status_code=403, detail="Access denied. Path must be inside your workspace.")
            
        if not old_file.exists():
            raise HTTPException(status_code=404, detail="Source file or folder not found.")
            
        new_file.parent.mkdir(parents=True, exist_ok=True)
        old_file.rename(new_file)
        
        return JSONResponse(content={"success": True, "message": "Renamed successfully."})
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to rename: {e}")


@app.post("/api/workspace/terminal")
def execute_terminal(
    req: TerminalExecuteRequest,
    x_user: Optional[str] = Header(None),
    user: Optional[str] = Query(None)
):
    """Executes a command inside the user's workspace (cwd=workspace/leon/username)."""
    import subprocess
    user_dir = get_user_workspace_from_request(x_user, user)
    
    command_str = req.command.strip()
    if not command_str:
        return JSONResponse(content={"stdout": "", "stderr": "Empty command", "code": 0})
        
    cmd_lower = command_str.lower()
    blocked_patterns = ["..", "rmdir /s", "del /f /s /q c:", "format", "shutdown", "reboot", "taskkill", "killall"]
    for pattern in blocked_patterns:
        if pattern in cmd_lower:
            return JSONResponse(content={"stdout": "", "stderr": f"Command blocked: '{pattern}' is not allowed for security reasons.", "code": 1})
            
    try:
        env = dict(os.environ)
        env["WORKSPACE_DIR"] = str(user_dir)
        env["PYTHONIOENCODING"] = "utf-8"
        
        process = subprocess.run(
            command_str,
            shell=True,
            cwd=str(user_dir),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding='utf-8',
            timeout=30,
            env=env
        )
        
        return JSONResponse(content={
            "stdout": process.stdout,
            "stderr": process.stderr,
            "code": process.returncode
        })
    except subprocess.TimeoutExpired:
        return JSONResponse(content={
            "stdout": "",
            "stderr": "Command execution timed out (limit: 30 seconds).",
            "code": -1
        })
    except Exception as e:
        return JSONResponse(content={
            "stdout": "",
            "stderr": f"Execution error: {e}",
            "code": -2
        })


@app.post("/api/workspace/clear")
async def clear_workspace(
    x_user: Optional[str] = Header(None),
    user: Optional[str] = Query(None)
):
    """Clears all files and directories in the user's workspace directory."""
    user_dir = get_user_workspace_from_request(x_user, user)
    if not user_dir.exists():
        return JSONResponse(content={"success": True, "message": "Workspace directory does not exist."})
        
    try:
        for item in os.listdir(user_dir):
            item_path = user_dir / item
            if item_path.is_dir():
                shutil.rmtree(item_path)
            else:
                os.unlink(item_path)
        
        return JSONResponse(content={"success": True, "message": "Workspace cleared successfully."})
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to clear workspace: {e}")


# --- Workspace File API ---


@app.get("/api/workspace/tree")
def get_workspace_tree(
    x_user: Optional[str] = Header(None),
    user: Optional[str] = Query(None)
):
    """Returns the recursive file tree of the user's workspace."""
    user_dir = get_user_workspace_from_request(x_user, user)
    tree = get_tree_nodes(user_dir, user_dir)
    return JSONResponse(content=tree)


@app.get("/api/workspace/file")
def get_file(
    path: str = Query(..., description="Relative path from user workspace"),
    x_user: Optional[str] = Header(None),
    user: Optional[str] = Query(None)
):
    """Reads and returns the content of a file in the user's workspace."""
    user_dir = get_user_workspace_from_request(x_user, user)
    file_path = user_dir / path
    try:
        resolved = file_path.resolve()
        if not str(resolved).startswith(str(user_dir.resolve())):
            raise HTTPException(status_code=403, detail="Access denied. Path must be inside your workspace.")
    except Exception:
        raise HTTPException(status_code=403, detail="Access denied. Invalid path.")

    if not file_path.exists():
        raise HTTPException(status_code=404, detail=f"File {path} not found.")

    # Check if the file is an image using mime type
    mime_type, _ = mimetypes.guess_type(str(file_path))
    if mime_type and mime_type.startswith("image/"):
        try:
            binary_data = file_path.read_bytes()
            base64_data = base64.b64encode(binary_data).decode('utf-8')
            data_url = f"data:{mime_type};base64,{base64_data}"
            return JSONResponse(content={"path": path, "content": data_url, "is_image": True})
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Failed to read image file: {e}")

    if file_path.suffix.lower() == '.docx':
        try:
            from server.chat.docx_parser import extract_docx_text
            content = extract_docx_text(file_path)
            return JSONResponse(content={"path": path, "content": content})
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Failed to parse Word file: {e}")

    if file_path.suffix.lower() == '.pptx':
        try:
            from server.chat.pptx_parser import extract_pptx_text
            content = extract_pptx_text(file_path)
            return JSONResponse(content={"path": path, "content": content})
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Failed to parse PPTX file: {e}")

    try:
        content = file_path.read_text(encoding='utf-8')
        return JSONResponse(content={"path": path, "content": content})
    except UnicodeDecodeError:
        # Fallback for other binary files
        try:
            binary_data = file_path.read_bytes()
            base64_data = base64.b64encode(binary_data).decode('utf-8')
            mime = mime_type or "application/octet-stream"
            data_url = f"data:{mime};base64,{base64_data}"
            return JSONResponse(content={"path": path, "content": data_url, "is_binary": True})
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Failed to read binary file: {e}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to read file: {e}")


@app.get("/api/workspace/file/raw")
def get_file_raw(
    path: str = Query(..., description="Relative path from user workspace"),
    x_user: Optional[str] = Header(None),
    user: Optional[str] = Query(None)
):
    """Returns the raw file content directly, suitable for iframe/image resources."""
    user_dir = get_user_workspace_from_request(x_user, user)
    file_path = user_dir / path
    try:
        resolved = file_path.resolve()
        if not str(resolved).startswith(str(user_dir.resolve())):
            raise HTTPException(status_code=403, detail="Access denied. Path must be inside your workspace.")
    except Exception:
        raise HTTPException(status_code=403, detail="Access denied. Invalid path.")

    if not file_path.exists():
        raise HTTPException(status_code=404, detail=f"File {path} not found.")

    return FileResponse(file_path)


@app.post("/api/workspace/file")
def write_file(
    req: FileWriteRequest,
    x_user: Optional[str] = Header(None),
    user: Optional[str] = Query(None)
):
    """Writes content to a file in the user's workspace."""
    user_dir = get_user_workspace_from_request(x_user, user)
    file_path = user_dir / req.path
    try:
        resolved = file_path.resolve()
        if not resolved.exists():
            resolved = file_path.parent.resolve()
        if not str(resolved).startswith(str(user_dir.resolve())):
            raise HTTPException(status_code=403, detail="Access denied. Path must be inside your workspace.")
    except Exception:
        raise HTTPException(status_code=403, detail="Access denied. Invalid path.")

    try:
        file_path.parent.mkdir(parents=True, exist_ok=True)
        file_path.write_text(req.content, encoding='utf-8')
        return JSONResponse(content={"success": True, "message": f"File written successfully to {req.path}"})
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to write file: {e}")


@app.delete("/api/workspace/file")
def delete_file(
    path: str = Query(..., description="Relative path from user workspace"),
    x_user: Optional[str] = Header(None),
    user: Optional[str] = Query(None)
):
    """Deletes a file or folder in the user's workspace."""
    user_dir = get_user_workspace_from_request(x_user, user)
    file_path = user_dir / path
    try:
        resolved = file_path.resolve()
        if not str(resolved).startswith(str(user_dir.resolve())):
            raise HTTPException(status_code=403, detail="Access denied. Path must be inside your workspace.")
    except Exception:
        raise HTTPException(status_code=403, detail="Access denied. Invalid path.")

    if not file_path.exists():
        raise HTTPException(status_code=404, detail="File or directory not found.")

    try:
        if file_path.is_dir():
            shutil.rmtree(file_path)
        else:
            file_path.unlink()
        return JSONResponse(content={"success": True, "message": "File or folder deleted successfully."})
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to delete path: {e}")


class ExportRequest(BaseModel):
    type: Optional[str] = "all"


@app.post("/api/workspace/export")
def export_workspace(
    req: Optional[ExportRequest] = None,
    x_user: Optional[str] = Header(None),
    user: Optional[str] = Query(None)
):
    """Zips the user's entire workspace directory and returns size + download URL."""
    user_dir = get_user_workspace_from_request(x_user, user)
    
    zip_filename = "export.zip"
    zip_path = user_dir / zip_filename
    
    try:
        # Create the zip file
        with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zip_file:
            for root, dirs, files in os.walk(user_dir):
                for file in files:
                    file_path = Path(root) / file
                    # Exclude the export.zip file itself to avoid recursive zipping!
                    if file_path.resolve() == zip_path.resolve():
                        continue
                    
                    relative_path = file_path.relative_to(user_dir)
                    zip_file.write(file_path, relative_path)
        
        size_bytes = zip_path.stat().st_size
        return JSONResponse(content={
            "success": True, 
            "download_url": f"/api/workspace/download?path={zip_filename}&user={user_dir.name}",
            "size_bytes": size_bytes
        })
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to package workspace: {e}")


@app.get("/api/workspace/download")
def download_file(
    path: str = Query(..., description="Relative path from user workspace"),
    x_user: Optional[str] = Header(None),
    user: Optional[str] = Query(None)
):
    """Serves a file for client download (primarily export zip files)."""
    user_dir = get_user_workspace_from_request(x_user, user)
    file_path = user_dir / path
    try:
        resolved = file_path.resolve()
        if not str(resolved).startswith(str(user_dir.resolve())):
            raise HTTPException(status_code=403, detail="Access denied. Path must be inside your workspace.")
    except Exception:
        raise HTTPException(status_code=403, detail="Access denied. Invalid path.")

    if not file_path.exists():
        raise HTTPException(status_code=404, detail="File not found.")

    return FileResponse(
        path=str(file_path),
        filename=file_path.name,
        media_type="application/octet-stream"
    )



@app.websocket("/ws/chat")
async def chat_endpoint(websocket: WebSocket):
    """WebSocket endpoint for real-time chat. Parses 'user' query param to isolate context."""
    username = websocket.query_params.get("user")
    if not username:
        await websocket.close(code=4001, reason="Missing user query parameter")
        return

    try:
        user_workspace = ensure_user_workspace_exists(username)
    except ValueError:
        await websocket.close(code=4002, reason="Invalid user name")
        return

    # Instantiate handler for this specific user
    conn_handler = ChatWebSocketHandler(str(user_workspace))
    await conn_handler.handle_connection(websocket)


if __name__ == "__main__":
    import uvicorn
    host = os.getenv("SERVER_HOST", "127.0.0.1")
    port = int(os.getenv("SERVER_PORT", "8900"))
    uvicorn.run("app:app", host=host, port=port, reload=True)
