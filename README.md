<h1 align="center">
    Qlue-UI
</h1>

**Qlue-UI** is a modern and **engine agnostic** web interface for **SPARQL**, driven by the [Qlue-ls](https://github.com/IoannisNezis/Qlue-ls) language server.

---

> TODO: one main video here that shows completion, formatting, diagnostics+code action and result presentation.
> Write a sample query (e.g. actors in Star Trek with role, actor's name and image) using completion. Write with wrong formatting and small mistakes. Then use formatting and code actions to fix that. (Or code action to add a variable to the select.) Finally execute the query and marvel at the results.

## Features

- supports all SPARQL Query types (`SELECT`, `CONSTRUCT`, `DESCRIBE`, `ASK`) and SPARQL Update
- elegant and modern result presentation (SPARQL Update only with QLever endpoints)
- intelligent query completions
- powerful and configurable query formatting
- diagnostics and code actions
- automatic import of prefixes
- query sharing
- configurable example queries (included for many datasets)
- work on multiple queries at once using tabs
- command palette and shortcuts for quick access to all features

> TODO: videos of the features in collapsible sections

Advanced features:

- view the parse tree of the SPARQL query
- live editor for the completions queries for rapid iteration (experimental)

> TODO: videos of the features in collapsible sections

QLever specific features:

- see the query execute with the query execution tree {video!}

---

## Quick Start

Follow these steps to get Qlue-UI up and running:

### 1. Prepare the environment

```bash
cp db.sqlite3.dist db.sqlite3
cp .env.dist .env
```

Then open .env and update the values according to your setup.

### 2. Change ownership of the db

```bash
chown 1000 db.sqlite3
```

### 3. Build and run with Docker

```bash
docker compose build
docker compose up
```

Qlue-ui is now available under <http://localhost:7000>

For advanced deployment options including behind a proxy, nginx or apache see the [deployment documentation](https://docs.qlever.dev/).

---

## Development Setup

For local development, set up the frontend and backend separately.

### Backend Setup

The backend uses **uv** as the package manager.

```bash
cd backend
uv sync                              # Install dependencies
uv run python manage.py migrate      # Run migrations
uv run python manage.py runserver    # Start server on port 8000
```

### Frontend Setup

```bash
cd frontend
npm install
npm run dev   # Start dev server on port 5173
```

Or run both together:
```bash
cd frontend && npm run dev-test
```

---

## License

[Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0)
