import sqlite3
import secrets
import string
from datetime import date


SHORT_ID_LENGTH = 6
SHORT_ID_ALPHABET = string.ascii_letters + string.digits


def _generate_short_id() -> str:
    return "".join(secrets.choice(SHORT_ID_ALPHABET) for _ in range(SHORT_ID_LENGTH))


def _normalize_query(query: str) -> str:
    return query.replace("\r\n", "\n").replace("\r", "\n")


class QueryStore:
    """SQLite-backed store for shared SPARQL queries."""

    def __init__(self, conn: sqlite3.Connection) -> None:
        self._conn = conn

    def save(self, query: str) -> tuple[str, date]:
        """Store a query and return (short_id, creation_date)."""
        normalized = _normalize_query(query)

        # Return existing entry if the same query was already shared.
        # Placeholders (?) prevent SQL injection, see:
        # https://docs.python.org/3/library/sqlite3.html#how-to-use-placeholders-to-bind-values-in-sql-queries
        row = self._conn.execute(
            "SELECT id, creation_date FROM shared_query WHERE query = ?",
            (normalized,),
        ).fetchone()
        if row:
            return row[0], date.fromisoformat(row[1])

        short_id = _generate_short_id()
        today = date.today()
        self._conn.execute(
            "INSERT INTO shared_query (id, query, creation_date) VALUES (?, ?, ?)",
            (short_id, normalized, today.isoformat()),
        )
        self._conn.commit()
        return short_id, today

    def get(self, short_id: str) -> tuple[str, date] | None:
        """Look up a shared query by its short ID. Returns (query, creation_date) or None."""
        row = self._conn.execute(
            "SELECT query, creation_date FROM shared_query WHERE id = ?",
            (short_id,),
        ).fetchone()
        if row:
            return row[0], date.fromisoformat(row[1])
        return None
