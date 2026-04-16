import logging
import sqlite3
from pathlib import Path

logger = logging.getLogger("uvicorn.error")


def connect(db_path: Path) -> sqlite3.Connection:
    """Open a SQLite connection and initialise the schema."""
    logger.info("Opening database at %s", db_path)
    conn = sqlite3.connect(db_path, check_same_thread=False)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS shared_query (
            id            TEXT PRIMARY KEY,
            query         TEXT NOT NULL,
            query_hash    TEXT NOT NULL,
            creation_date TEXT NOT NULL,
            share_count   INTEGER NOT NULL DEFAULT 1,
            view_count    INTEGER NOT NULL DEFAULT 0
        )
        """
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_shared_query_hash ON shared_query (query_hash)"
    )
    conn.commit()
    return conn
