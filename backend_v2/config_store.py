import yaml
import hashlib
import asyncio
from pathlib import Path
from typing import Any

from models import AppConfig, validate_config


class Store:
    """Thread/async-safe wrapper around the in-memory YAML data."""

    def __init__(self, filepath: Path) -> None:
        self._data: dict[str, Any] = {}
        self._lock = asyncio.Lock()
        self._file_hash: str = ""
        self._file_path = filepath

    async def load(self) -> None:
        async with self._lock:
            if self._file_path.exists():
                raw = self._file_path.read_bytes()
                self._file_hash = hashlib.sha256(raw).hexdigest()
                parsed_data = yaml.safe_load(raw) or {}
                self._data = validate_config(parsed_data)
            else:
                self._data = {}
                self._file_hash = ""

    async def get_all(self) -> dict[str, Any]:
        """Return the live internal state. DO NOT mutate the result."""
        async with self._lock:
            return self._data
