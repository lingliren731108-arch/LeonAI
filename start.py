#!/usr/bin/env python3
"""Leon AI Startup Script

Launches the FastAPI backend and the Vite React frontend dev server concurrently,
handles clean process termination, and launches the browser automatically.
"""

import os
import subprocess
import sys
import time
import webbrowser
from pathlib import Path


def main() -> int:
    root_dir = Path(__file__).parent.resolve()
    frontend_dir = root_dir / "frontend"
    server_dir = root_dir / "server"

    print("🚀 Starting Leon AI development environment...")

    # 1. Verify frontend package.json dependencies are installed
    if not (frontend_dir / "node_modules").exists():
        print("📦 Node modules not found. Installing frontend dependencies...")
        try:
            subprocess.run("npm install", shell=True, cwd=str(frontend_dir), check=True)
        except subprocess.CalledProcessError as e:
            print(f"❌ Failed to install frontend dependencies: {e}", file=sys.stderr)
            return 1

    # 2. Verify server requirements are installed
    requirements_file = root_dir / "requirements.txt"
    if requirements_file.exists():
        print("🐍 Ensuring Python dependencies are up-to-date...")
        try:
            subprocess.run([sys.executable, "-m", "pip", "install", "-r", str(requirements_file)], check=True)
        except subprocess.CalledProcessError as e:
            print(f"⚠️ Warning: Python requirements check returned error: {e}", file=sys.stderr)
            # Continue anyway, dependencies might be pre-installed

    # Load .env variables into environment
    try:
        from dotenv import load_dotenv
        load_dotenv(root_dir / ".env")
    except Exception:
        pass

    # Create workspace directories to avoid initial errors
    (root_dir / "workspace" / "leon").mkdir(parents=True, exist_ok=True)

    # 3. Spin up Backend FastAPI
    backend_host = os.getenv("SERVER_HOST", "127.0.0.1")
    backend_port = os.getenv("SERVER_PORT", "8900")

    print(f"⚡ Starting FastAPI Backend on http://{backend_host}:{backend_port} ...")
    backend_env = os.environ.copy()
    # Add root folder to pythonpath for imports
    backend_env["PYTHONPATH"] = str(root_dir) + os.path.pathsep + backend_env.get("PYTHONPATH", "")
    
    # We run uvicorn module from current python executable
    backend_proc = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "server.app:app", "--host", backend_host, "--port", backend_port, "--reload"],
        cwd=str(root_dir),
        env=backend_env
    )

    # 4. Spin up Frontend Vite
    frontend_port = os.getenv("FRONTEND_PORT", "5173")
    print(f"🎨 Starting React/Vite Frontend on http://localhost:{frontend_port} ...")
    # Using shell=True for npm command compatibility on Windows
    frontend_proc = subprocess.Popen(
        "npm run dev",
        shell=True,
        cwd=str(frontend_dir)
    )

    # Wait 2 seconds for servers to initialize
    time.sleep(2)

    # 5. Open browser
    print("🌐 Launching web browser to Leon interface...")
    webbrowser.open(f"http://localhost:{frontend_port}")

    print("\n🎉 Leon AI is fully running!")
    print("Press Ctrl+C to terminate both servers and exit.\n")

    # Monitor processes
    try:
        while True:
            # Check if either process died
            if backend_proc.poll() is not None:
                print("❌ Backend server terminated unexpectedly.")
                break
            if frontend_proc.poll() is not None:
                print("❌ Frontend dev server terminated unexpectedly.")
                break
            time.sleep(1)
    except KeyboardInterrupt:
        print("\n🛑 Stopping servers...")
    finally:
        # Graceful cleanup
        print("🧹 Cleaning up subprocesses...")
        # Kill backend
        try:
            backend_proc.terminate()
            backend_proc.wait(timeout=2)
        except Exception:
            backend_proc.kill()
        
        # Kill frontend
        try:
            # On Windows, terminating a shell Popen requires killing child process tree
            if os.name == 'nt':
                subprocess.run(f"taskkill /F /T /PID {frontend_proc.pid}", shell=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            else:
                frontend_proc.terminate()
                frontend_proc.wait(timeout=2)
        except Exception:
            try:
                frontend_proc.kill()
            except Exception:
                pass
        
        print("👋 Goodbye!")
    return 0


if __name__ == "__main__":
    sys.exit(main())
