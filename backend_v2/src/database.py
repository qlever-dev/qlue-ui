import sqlite3
from pathlib import Path


def connect(db_path: Path) -> sqlite3.Connection:
    """Open a SQLite connection and initialise the schema."""
    conn = sqlite3.connect(db_path)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS shared_query (
            id            TEXT PRIMARY KEY,
            query         TEXT NOT NULL,
            creation_date TEXT NOT NULL
        )
        """
    )
    conn.commit()
    return conn
