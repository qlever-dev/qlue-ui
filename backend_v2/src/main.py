from contextlib import asynccontextmanager
from datetime import date
from fastapi import Body, FastAPI
from pathlib import Path
import os

from config_store import Store
from database import connect
from models import SharedQueryResponse, SparqlEndpointConfiguration
from query_store import QueryStore

CONFIG_PATH = Path(os.getenv("CONFIG_FILE", "config.yaml")).resolve()
EXAMPLES_DIR = Path(os.getenv("EXAMPLES_DIR", "examples")).resolve()
DB_PATH = Path(os.getenv("DB_FILE", "shared_queries.db")).resolve()
API_TOKEN = os.getenv("API_TOKEN", "changeme")  # WARN: rotate in production!


# ── Stores ─────────────────────────────────────────────────────────────────
store = Store(CONFIG_PATH)
db = connect(DB_PATH)
query_store = QueryStore(db)


# ── Lifespan (startup / shutdown) ───────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    await store.load()
    yield
    # Shutdown
    db.close()


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
    """Retrieve all public endpoint configurations (hidden endpoints are excluded)."""
    data = await store.get_all()
    return data


@app.get("/endpoints/{slug}")
async def get_endpoint(slug: str) -> SparqlEndpointConfiguration:
    """Retrieve a single SPARQL endpoint configuration by its slug."""
    data = await store.get_all()
    return data[slug]


@app.get("/endpoints/{slug}/examples/")
async def list_examples(slug: str) -> list[dict[str, str]]:
    """Retrieve all example queries for an endpoint. Returns an empty list if none exist."""
    slug_dir = EXAMPLES_DIR / slug
    if not slug_dir.is_dir():
        return []
    return [
        {"name": p.stem, "query": p.read_text()} for p in sorted(slug_dir.glob("*.rq"))
    ]


@app.post("/shared-query/")
async def share_query(
    query: str = Body(media_type="text/plain"),
) -> SharedQueryResponse:
    """
    Store a SPARQL query and return a short ID for sharing.

    The query must be sent as a raw plain-text string in the request body
    (Content-Type: text/plain).
    """
    short_id, creation_date = query_store.save(query)
    return SharedQueryResponse(id=short_id, count=0, creation_date=creation_date)
