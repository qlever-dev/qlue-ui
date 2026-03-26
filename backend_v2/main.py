from contextlib import asynccontextmanager
from fastapi import FastAPI
from pathlib import Path
import os

from config_store import Store
from models import SparqlEndpointConfiguration

CONFIG_PATH = Path(os.getenv("CONFIG_FILE", "config.yaml")).resolve()
EXAMPLES_DIR = Path(os.getenv("EXAMPLES_DIR", "examples")).resolve()
API_TOKEN = os.getenv("API_TOKEN", "changeme")  # WARN: rotate in production!


# ── In-memory store ─────────────────────────────────────────────────────────
store = Store(CONFIG_PATH)


# ── Lifespan (startup / shutdown) ───────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    await store.load()
    yield
    # Shutdown


# ── App & Routes ─────────────────────────────────────────────────────────

app = FastAPI(
    title="QLever-UI JSON API",
    version="1.0.0",
    description="Expose SPARQL endpoint configurations, shared queries and example as JSON API.",
    lifespan=lifespan,
)


@app.get("/health")
async def health():
    """Unauthenticated health check."""
    return {"status": "ok", "yaml_path": str(CONFIG_PATH)}


@app.get("/endpoints/")
async def list_endpoints() -> dict[str, SparqlEndpointConfiguration]:
    """
    Retrieve all VISIBLE enpoints.
    """
    data = await store.get_all()
    return data


@app.get("/endpoints/{slug}")
async def get_endpoint(slug: str) -> SparqlEndpointConfiguration:
    """
    Retrieve a specific endpoint by SLUG.
    """
    data = await store.get_all()
    return data[slug]


@app.get("/endpoints/{slug}/examples/")
async def list_examples(slug: str) -> list[dict[str, str]]:
    """
    Retrieve all example queries for an endpoint.
    """
    slug_dir = EXAMPLES_DIR / slug
    if not slug_dir.is_dir():
        return []
    return [
        {"name": p.stem, "query": p.read_text()}
        for p in sorted(slug_dir.glob("*.rq"))
    ]
