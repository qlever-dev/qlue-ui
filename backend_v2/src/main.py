from contextlib import asynccontextmanager
from fastapi import Body, FastAPI, HTTPException

from pathlib import Path
import os

from config_store import Store
from database import connect
from models import SharedQuery, SparqlEndpointConfiguration
from query_store import QueryStore

CONFIG_PATH = Path(os.getenv("CONFIG_FILE", "config.yaml")).resolve()
EXAMPLES_DIR = Path(os.getenv("EXAMPLES_DIR", "examples")).resolve()
DB_PATH = Path(os.getenv("DB_FILE", "data.db")).resolve()
MAX_QUERY_LENGTH = 100_000  # bytes — reject unreasonably large shared queries


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
    if slug not in data:
        raise HTTPException(
            status_code=404, detail=f'endpoint with slug "{slug}" not found'
        )
    return data[slug]


@app.get("/endpoints/{slug}/examples/")
async def list_examples(slug: str) -> list[dict[str, str]]:
    """Retrieve all example queries for an endpoint. Returns an empty list if none exist."""
    slug_dir = (EXAMPLES_DIR / slug).resolve()
    if not slug_dir.is_relative_to(EXAMPLES_DIR):
        raise HTTPException(status_code=400, detail="Invalid slug")
    if not slug_dir.is_dir():
        return []
    return [
        {"name": p.stem, "query": p.read_text()} for p in sorted(slug_dir.glob("*.rq"))
    ]


@app.post("/shared-query/")
def share_query(
    query: str = Body(media_type="text/plain"),
) -> SharedQuery:
    """
    Store a SPARQL query and return a short ID for sharing.

    The query must be sent as a raw plain-text string in the request body
    (Content-Type: text/plain). Returns 413 if the body exceeds 100 KB.
    """
    if len(query.encode()) > MAX_QUERY_LENGTH:
        raise HTTPException(
            status_code=413,
            detail=f"Query exceeds maximum size of {MAX_QUERY_LENGTH} bytes",
        )
    short_id, creation_date = query_store.save(query)
    return SharedQuery(id=short_id, query=query, creation_date=creation_date)


@app.get("/shared-query/{short_id}")
def get_shared_query(short_id: str) -> SharedQuery:
    """Retrieve a shared query by its short ID."""
    result = query_store.get(short_id)
    if result is None:
        raise HTTPException(status_code=404, detail="Shared query not found")
    query, creation_date = result
    return SharedQuery(id=short_id, query=query, creation_date=creation_date)
