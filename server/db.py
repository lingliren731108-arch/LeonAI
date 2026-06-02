import os
import pymysql
from pathlib import Path
from dotenv import load_dotenv

# Load env in case it's not loaded
root_path = Path(__file__).parent.parent
load_dotenv(root_path / ".env")

MYSQL_HOST = os.getenv("MYSQL_HOST", "127.0.0.1")
MYSQL_PORT = int(os.getenv("MYSQL_PORT", "3306"))
MYSQL_USER = os.getenv("MYSQL_USER", "root")
MYSQL_PASSWORD = os.getenv("MYSQL_PASSWORD", "root")
MYSQL_DB = os.getenv("MYSQL_DB", "leon_db")

def get_connection(use_db=True):
    """Establish a connection to MySQL, optionally selecting the database."""
    return pymysql.connect(
        host=MYSQL_HOST,
        port=MYSQL_PORT,
        user=MYSQL_USER,
        password=MYSQL_PASSWORD,
        database=MYSQL_DB if use_db else None,
        charset='utf8mb4',
        cursorclass=pymysql.cursors.DictCursor
    )

def init_db():
    """Initializes the database, user table, and default admin user if not exists."""
    print("Initializing database...")
    # First connect without selecting a database
    conn = pymysql.connect(
        host=MYSQL_HOST,
        port=MYSQL_PORT,
        user=MYSQL_USER,
        password=MYSQL_PASSWORD,
        charset='utf8mb4'
    )
    try:
        with conn.cursor() as cursor:
            # Create database if not exists
            cursor.execute(f"CREATE DATABASE IF NOT EXISTS {MYSQL_DB} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci")
        conn.commit()
    finally:
        conn.close()

    # Now connect to the database to create tables
    conn = get_connection()
    try:
        with conn.cursor() as cursor:
            # Create users table
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS users (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    username VARCHAR(80) NOT NULL UNIQUE,
                    password VARCHAR(120) NOT NULL,
                    role VARCHAR(20) NOT NULL DEFAULT 'user',
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            
            # Check if admin exists, if not insert
            cursor.execute("SELECT id FROM users WHERE username = %s", ("admin",))
            if not cursor.fetchone():
                cursor.execute(
                    "INSERT INTO users (username, password, role) VALUES (%s, %s, %s)",
                    ("admin", "admin123", "admin")
                )
        conn.commit()
        print("Database initialization completed successfully.")
    except Exception as e:
        print(f"Error during database initialization: {e}")
        raise e
    finally:
        conn.close()

def get_user(username: str):
    conn = get_connection()
    try:
        with conn.cursor() as cursor:
            cursor.execute("SELECT * FROM users WHERE username = %s", (username,))
            return cursor.fetchone()
    finally:
        conn.close()

def list_users():
    conn = get_connection()
    try:
        with conn.cursor() as cursor:
            cursor.execute("SELECT id, username, password, role, created_at FROM users")
            return cursor.fetchall()
    finally:
        conn.close()

def create_user(username: str, password: str, role: str = "user"):
    conn = get_connection()
    try:
        with conn.cursor() as cursor:
            # Check unique username first
            cursor.execute("SELECT id FROM users WHERE username = %s", (username,))
            if cursor.fetchone():
                raise ValueError(f"Username '{username}' already exists.")
            
            cursor.execute(
                "INSERT INTO users (username, password, role) VALUES (%s, %s, %s)",
                (username, password, role)
            )
        conn.commit()
        return True
    finally:
        conn.close()

def update_user(user_id: int, username: str, password: str, role: str):
    conn = get_connection()
    try:
        with conn.cursor() as cursor:
            # Check unique username for other users
            cursor.execute("SELECT id FROM users WHERE username = %s AND id != %s", (username, user_id))
            if cursor.fetchone():
                raise ValueError(f"Username '{username}' already exists.")
            
            cursor.execute(
                "UPDATE users SET username = %s, password = %s, role = %s WHERE id = %s",
                (username, password, role, user_id)
            )
        conn.commit()
        return True
    finally:
        conn.close()

def delete_user(user_id: int):
    conn = get_connection()
    try:
        with conn.cursor() as cursor:
            # Prevent deleting the last admin or the admin user itself
            cursor.execute("SELECT username FROM users WHERE id = %s", (user_id,))
            user = cursor.fetchone()
            if user and user["username"] == "admin":
                raise ValueError("Cannot delete default 'admin' account.")
                
            cursor.execute("DELETE FROM users WHERE id = %s", (user_id,))
        conn.commit()
        return True
    finally:
        conn.close()
