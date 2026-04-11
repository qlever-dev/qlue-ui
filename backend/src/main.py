import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Body, Depends, FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.responses import Response
from starlette.types import Scope

from config_store import ConfigStore
from database import connect
from models import (
    ExampleQuery,
    SharedQuery,
    SparqlEndpointConfiguration,
    SparqlEndpointPatch,
)
from query_store import QueryStore

logger = logging.getLogger("uvicorn.error")

CONFIG_PATH = Path(os.getenv("CONFIG_FILE", "config.yaml")).resolve()
EXAMPLES_DIR = Path(os.getenv("EXAMPLES_DIR", "examples")).resolve()
DB_PATH = Path(os.getenv("DB_FILE", "data.db")).resolve()
FRONTEND_DIR = Path(os.getenv("FRONTEND_DIR", "frontend_dist"))
MAX_QUERY_LENGTH = 100_000  # bytes — reject unreasonably large shared queries
API_KEY = os.getenv("API_KEY")


class SPAStaticFiles(StaticFiles):
    """Serves static files with SPA fallback: unknown paths return index.html."""

    async def get_response(self, path: str, scope: Scope) -> Response:
        try:
            return await super().get_response(path, scope)
        except StarletteHTTPException as ex:
            if ex.status_code == 404:
                return await super().get_response(".", scope)
            raise


def require_api_key(x_api_key: str | None = Header(default=None)):
    if API_KEY is None or x_api_key != API_KEY:
        raise HTTPException(status_code=403, detail="Invalid API key")


# ── Stores ─────────────────────────────────────────────────────────────────
store = ConfigStore(CONFIG_PATH)
db = connect(DB_PATH)
query_store = QueryStore(db)


# ── Lifespan (startup / shutdown) ───────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Config file: %s", CONFIG_PATH)
    logger.info("Examples dir: %s", EXAMPLES_DIR)
    logger.info("Database: %s", DB_PATH)
    logger.info("API key: %s", "set" if API_KEY else "not set")
    await store.load()
    yield
    db.close()
    logger.info("Database connection closed")


# ── App & Routes ─────────────────────────────────────────────────────────

app = FastAPI(
    title="QLever-UI JSON API",
    version="1.0.0",
    description="Expose SPARQL endpoint configurations, shared queries and example as JSON API.",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("CORS_ORIGINS", "*").split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)

router = APIRouter()


@router.get("/health")
async def health():
    """Unauthenticated health check."""
    return {"status": "ok"}


@router.get("/endpoints/", response_model_exclude_none=True)
async def list_endpoints() -> dict[str, SparqlEndpointConfiguration]:
    """Retrieve all public endpoint configurations (hidden endpoints are excluded)."""
    data = await store.get_all()
    return data


@router.get("/endpoints/{slug}/", response_model_exclude_none=True)
async def get_endpoint(slug: str) -> SparqlEndpointConfiguration:
    """Retrieve a single SPARQL endpoint configuration by its slug."""
    data = await store.get_all()
    if slug not in data:
        raise HTTPException(
            status_code=404, detail=f'endpoint with slug "{slug}" not found'
        )
    return data[slug]


@router.patch("/endpoints/{slug}/", dependencies=[Depends(require_api_key)])
async def patch_endpoint(slug: str, patch: SparqlEndpointPatch):
    """Partially update an endpoint configuration. Only provided top-level fields
    are changed. Nested objects like `queryTemplates` are replaced in full — send
    the complete object, not individual sub-fields."""
    update_data = patch.model_dump(exclude_unset=True)

    def apply(current: dict[str, Any]) -> dict[str, Any]:
        stored = SparqlEndpointConfiguration.model_validate(current)
        updated = stored.model_copy(update=update_data)
        return updated.model_dump(mode="json", exclude_none=True)

    try:
        return await store.patch(slug, apply)
    except KeyError:
        raise HTTPException(
            status_code=404, detail=f'endpoint with slug "{slug}" not found'
        )


@router.get("/endpoints/{slug}/examples/")
async def list_examples(slug: str) -> list[ExampleQuery]:
    """Retrieve all example queries for an endpoint. Returns an empty list if none exist."""
    slug_dir = (EXAMPLES_DIR / slug).resolve()
    if not slug_dir.is_relative_to(EXAMPLES_DIR):
        raise HTTPException(status_code=400, detail="Invalid slug")
    if not slug_dir.is_dir():
        return []
    return [
        ExampleQuery(name=p.stem, query=p.read_text())
        for p in sorted(slug_dir.glob("*.rq"))
    ]


@router.put("/endpoints/{slug}/examples/", dependencies=[Depends(require_api_key)])
async def update_example(slug: str, example: ExampleQuery):
    """Overwrite the content of an existing example query file."""
    slug_dir = (EXAMPLES_DIR / slug).resolve()
    if not slug_dir.is_relative_to(EXAMPLES_DIR):
        raise HTTPException(status_code=400, detail="Invalid slug")
    file_path = (slug_dir / f"{example.name}.rq").resolve()
    if not file_path.is_relative_to(slug_dir):
        raise HTTPException(status_code=400, detail="Invalid example name")
    if not file_path.is_file():
        raise HTTPException(
            status_code=404, detail=f'Example "{example.name}" not found'
        )
    file_path.write_text(example.query)


@router.post(
    "/endpoints/{slug}/examples/",
    dependencies=[Depends(require_api_key)],
    status_code=201,
)
async def create_example(slug: str, example: ExampleQuery):
    """Create a new example query file. Returns 409 if it already exists."""
    slug_dir = (EXAMPLES_DIR / slug).resolve()
    if not slug_dir.is_relative_to(EXAMPLES_DIR):
        raise HTTPException(status_code=400, detail="Invalid slug")
    file_path = (slug_dir / f"{example.name}.rq").resolve()
    if not file_path.is_relative_to(slug_dir):
        raise HTTPException(status_code=400, detail="Invalid example name")
    if file_path.exists():
        raise HTTPException(
            status_code=409, detail=f'Example "{example.name}" already exists'
        )
    slug_dir.mkdir(parents=True, exist_ok=True)
    file_path.write_text(example.query)


@router.delete(
    "/endpoints/{slug}/examples/",
    dependencies=[Depends(require_api_key)],
    status_code=204,
)
async def delete_example(slug: str, name: str = Body(embed=True)):
    """Delete an existing example query file."""
    slug_dir = (EXAMPLES_DIR / slug).resolve()
    if not slug_dir.is_relative_to(EXAMPLES_DIR):
        raise HTTPException(status_code=400, detail="Invalid slug")
    file_path = (slug_dir / f"{name}.rq").resolve()
    if not file_path.is_relative_to(slug_dir):
        raise HTTPException(status_code=400, detail="Invalid example name")
    if not file_path.is_file():
        raise HTTPException(status_code=404, detail=f'Example "{name}" not found')
    file_path.unlink()


@router.post("/shared-query/")
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


@router.get("/shared-query/{short_id}")
def get_shared_query(short_id: str) -> SharedQuery:
    """Retrieve a shared query by its short ID."""
    result = query_store.get(short_id)
    if result is None:
        raise HTTPException(status_code=404, detail="Shared query not found")
    query, creation_date = result
    return SharedQuery(id=short_id, query=query, creation_date=creation_date)


app.include_router(router, prefix="/ui-api")

if FRONTEND_DIR.is_dir():
    app.mount("/", SPAStaticFiles(directory=FRONTEND_DIR, html=True), name="spa")
