import hashlib
import secrets
import sqlite3
import string
import threading
from datetime import date

SHORT_ID_LENGTH = 6
SHORT_ID_ALPHABET = string.ascii_letters + string.digits


def _generate_short_id() -> str:
    return "".join(secrets.choice(SHORT_ID_ALPHABET) for _ in range(SHORT_ID_LENGTH))


def _normalize_query(query: str) -> str:
    return query.replace("\r\n", "\n").replace("\r", "\n")


def hash_query(query: str) -> str:
    return hashlib.sha256(query.encode()).hexdigest()


# NOTE: Placeholders (?) prevent SQL injection, see:
# https://docs.python.org/3/library/sqlite3.html#how-to-use-placeholders-to-bind-values-in-sql-queries
class QueryStore:
    """SQLite-backed store for shared SPARQL queries."""

    def __init__(self, conn: sqlite3.Connection) -> None:
        self._conn = conn
        self._lock = threading.Lock()

    def save(self, query: str) -> tuple[str, date]:
        """Store a query and return (short_id, creation_date)."""
        normalized = _normalize_query(query)

        query_hash = hash_query(normalized)

        with self._lock:
            row = self._conn.execute(
                "SELECT id, creation_date FROM shared_query WHERE query_hash = ? AND query = ?",
                (query_hash, normalized),
            ).fetchone()
            if row:
                self._conn.execute(
                    "UPDATE shared_query SET share_count = share_count + 1 WHERE id = ?",
                    (row[0],),
                )
                self._conn.commit()
                return row[0], date.fromisoformat(row[1])

            today = date.today()
            for _ in range(10):
                short_id = _generate_short_id()
                cursor = self._conn.execute(
                    "INSERT OR IGNORE INTO shared_query (id, query, query_hash, creation_date) VALUES (?, ?, ?, ?)",
                    (short_id, normalized, query_hash, today.isoformat()),
                )
                if cursor.rowcount == 1:
                    self._conn.commit()
                    return short_id, today
            raise RuntimeError("Failed to generate a unique short ID")

    def get(self, short_id: str) -> tuple[str, date] | None:
        """Look up a shared query by its short ID. Returns (query, creation_date) or None."""
        with self._lock:
            row = self._conn.execute(
                "SELECT query, creation_date FROM shared_query WHERE id = ?",
                (short_id,),
            ).fetchone()
            if row:
                self._conn.execute(
                    "UPDATE shared_query SET view_count = view_count + 1 WHERE id = ?",
                    (short_id,),
                )
                self._conn.commit()
                return row[0], date.fromisoformat(row[1])
            return None
