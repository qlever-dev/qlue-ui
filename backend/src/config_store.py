import yaml
import hashlib
import asyncio
import logging
from pathlib import Path
from typing import Any, Callable
from models import validate_config

logger = logging.getLogger("uvicorn.error")


class _Dumper(yaml.Dumper):
    pass


def _str_representer(dumper: yaml.Dumper, data: str) -> yaml.ScalarNode:
    if "\n" in data:
        return dumper.represent_scalar("tag:yaml.org,2002:str", data, style="|")
    return dumper.represent_scalar("tag:yaml.org,2002:str", data)


_Dumper.add_representer(str, _str_representer)


class ConfigStore:
    """Thread/async-safe wrapper around the in-memory YAML data."""

    def __init__(self, filepath: Path) -> None:
        self._data: dict[str, Any] = {}
        self._lock = asyncio.Lock()
        self._file_hash: str = ""
        self._file_path = filepath

    async def load(self) -> int:
        async with self._lock:
            if self._file_path.exists():
                raw = self._file_path.read_bytes()
                self._file_hash = hashlib.sha256(raw).hexdigest()
                parsed_data = yaml.safe_load(raw) or {}
                self._data = validate_config(parsed_data)
                return len(self._data)
            else:
                self._data = {}
                self._file_hash = ""
                return 0

    async def get_all(self) -> dict[str, Any]:
        """Return the live internal state. DO NOT mutate the result."""
        async with self._lock:
            return self._data

    async def create(self, slug: str, config: dict[str, Any]):
        async with self._lock:
            if slug in self._data:
                raise ValueError(f"config with slug {slug} already exists.")
            # NOTE: Make sure only one config is the "default" endpoint.
            if config["default"]:
                for config_slug in self._data:
                    self._data[config_slug]["default"] = False
            self._data[slug] = config
            self._persist()

    async def patch(
        self, slug: str, apply: Callable[[dict[str, Any]], dict[str, Any]]
    ) -> dict[str, Any]:
        """Read-modify-write an endpoint atomically.

        *apply* receives the current stored dict and must return the new one.
        Raises KeyError if the slug does not exist.  Rolls back on write failure.
        """
        async with self._lock:
            if slug not in self._data:
                raise KeyError(slug)
            prev = self._data[slug]
            self._data[slug] = apply(prev)
            try:
                self._persist()
            except Exception:
                self._data[slug] = prev
                raise
            return self._data[slug]

    def _persist(self) -> None:
        """Atomically write current state back to the YAML file."""
        raw = yaml.dump(
            self._data,
            Dumper=_Dumper,
            default_flow_style=False,
            allow_unicode=True,
            sort_keys=False,
        )
        tmp = self._file_path.with_suffix(".tmp")
        tmp.write_text(raw)
        tmp.replace(self._file_path)
        self._file_hash = hashlib.sha256(raw.encode()).hexdigest()
