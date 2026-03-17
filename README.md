<h1 align="center">
    Qlue-UI
</h1>

**Qlue-UI** is a modern WebUI for **SPARQL**, driven by [Qlue-ls](https://github.com/IoannisNezis/Qlue-ls).
It does not target a single, but **many** SPARQL engines.  
It’s small, shiny, and ready to help you explore your RDF data effortlessly.  

---

## Features

### SPARQL Editor

- Modern, lightweight WebUI for SPARQL with many language capabilities
    - completion
    - formatting
    - diagnostics
    - code actions
    - hover

<img width="1128" height="660" alt="normal-mode" src="https://github.com/user-attachments/assets/8dc1ab0d-aaf1-4e74-8463-acffdebedf4c" />

### Results Renderer

- Result views for ANY sparql operation (including update for QLever endpoints)

<img width="1129" height="831" alt="results" src="https://github.com/user-attachments/assets/44ea5142-4231-44c2-b079-b44dc04ced8d" />

### Query Execution Tree View

- Live query execution monitoring for QLever backends

<img width="1082" height="845" alt="analysis" src="https://github.com/user-attachments/assets/539900dc-0eca-4f5f-abfe-f4d580778f84" />

### Parse Tree View

- Parse tree view for inspecting the internal representation of a SPARQL query

<img width="1846" height="655" alt="parse-tree-mode" src="https://github.com/user-attachments/assets/6a7eaacf-9bd2-43b0-9550-46210584a898" />

### Completion Query Template Editor

- Live completion template editor for rapid iteration on query templates (experimental)

### Powerful Formatter with many options

<img width="266" height="401" alt="formatting-options" src="https://github.com/user-attachments/assets/f06e2196-382b-4770-8eaa-5e6ff09586fd" />

### Miscellaneous

- Tabs for multiple queries
- Share queries with your peers
- Proper indentation support for SPARQL ('.' and ';')
- Automatic line break after '.' or ';'
- Automatic addition or removal of PREFIX declarations (configurable)
- Jump to relevant positions in the query
- Manage example queries per SPARQL endpoint
- Easy deployment with Docker
- Clean separation of API and frontend

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

### 4. Deploying with a Proxy

**Your reverse proxy MUST set these headers:**
- X-Forwarded-Host
- X-Forwarded-Proto

In production (`DJANGO_DEBUG=False`, the default in `.env.dist`), these headers are always trusted.
If you are running in development mode (`DJANGO_DEBUG=True`) behind a proxy, set `IS_PROXIED=True` in `.env` to trust them.

> **Note:** The "Query Execution Tree View" opens a WebSocket directly from the browser to the QLever backend — it does not go through this proxy.

#### Apache example

Enable the required modules:
```bash
a2enmod proxy proxy_http headers
```

```apache
<VirtualHost *:443>
    ServerName qlue.example.com

    ProxyPreserveHost On
    RequestHeader set X-Forwarded-Proto "https"

    ProxyPass        / http://localhost:7000/
    ProxyPassReverse / http://localhost:7000/
</VirtualHost>
```

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `?` | Open help |
| `Escape` | Close any dialog |
| `Ctrl+Enter` | Execute/cancel query |
| `Ctrl+F` | Format document |
| `Ctrl+,` | Open settings |
| `Tab` | Jump to next position |
| `Shift+Tab` | Jump to previous position |

### Commands

Open the command prompt with `:` (editor must be out of focus) and type a command:

| Command | Action |
|---------|--------|
| `parseTree` | Open the parse tree panel |
| `templates` | Open the completion templates editor (experimental) |
| `updateExample` | Update the current example query |
| `createExample "<name>"` | Save the editor content as a new example for the active backend |

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

## Managing the Distribution Database

Qlue-UI uses a **distribution database** (`db.sqlite3.dist`) to ship default SPARQL backends and example queries. This file is committed to version control and serves as the template for new deployments.

Two management commands help you sync data between your development database and the distribution database.

### Sync Modes

| Mode | Flags | Behavior |
|------|-------|----------|
| **Reset** | *(default)* | ⚠️ **DELETES all existing data** and replaces with source |
| **Update** | `--update` | Adds new records, updates existing ones, **keeps** local-only records |
| **Sync** | `--update --delete` | ⚠️ Adds, updates, AND **DELETES** records not in source |

Records are matched by natural key (not auto-increment ID):
- `SparqlEndpointConfiguration`: matched by `name` field
- `QueryExample`: matched by `(backend.name, example.name)` tuple

### Import from Distribution

Import data from `db.sqlite3.dist` into your local database:

```bash
cd backend

# Preview what would be imported (always recommended first)
uv run python manage.py import_from_dist --backends --examples --dry-run
uv run python manage.py import_from_dist --backends --update --dry-run

# ⚠️ RESET MODE: Wipe and replace (DELETES existing data)
uv run python manage.py import_from_dist --backends --examples --force

# UPDATE MODE: Add/update records, keep local-only records (safe)
uv run python manage.py import_from_dist --backends --examples --update --force

# ⚠️ SYNC MODE: Full sync including deletions
uv run python manage.py import_from_dist --backends --update --delete --force

# Interactively select which records to import
uv run python manage.py import_from_dist --backends --select
uv run python manage.py import_from_dist --backends --select --update
```

### Export to Distribution

Export data from your local database to `db.sqlite3.dist` (for contributors):

```bash
cd backend

# Preview what would be exported
uv run python manage.py export_to_dist --backends --examples --dry-run
uv run python manage.py export_to_dist --backends --update --dry-run

# ⚠️ RESET MODE: Wipe and replace (DELETES existing data in dist)
uv run python manage.py export_to_dist --backends --examples --force

# UPDATE MODE: Add/update records, keep dist-only records (safe)
uv run python manage.py export_to_dist --backends --examples --update --force

# ⚠️ SYNC MODE: Full sync including deletions
uv run python manage.py export_to_dist --backends --update --delete --force

# Interactively select which records to export
uv run python manage.py export_to_dist --backends --select
uv run python manage.py export_to_dist --backends --select --update
```

### Available Options

| Option | Description |
|--------|-------------|
| `--backends` | Include SparqlEndpointConfiguration records |
| `--examples` | Include QueryExample records |
| `--saved` | Include SavedQuery records (not recommended) |
| `--all` | Include all models |
| `--select` | Interactively select records (use with `--backends` or `--examples`) |
| `--update` | Upsert mode: add/update without deleting other records |
| `--delete` | With `--update`: also delete records not in source ⚠️ |
| `--dry-run` | Preview changes without modifying data |
| `--force` | Skip confirmation prompt |

### Dry-run Output

With `--update`, the dry-run shows what will happen to each record:

```
[ADD]    new-backend          (not in destination)
[UPDATE] wikidata             (exists, will be updated)
[KEEP]   my-local-backend     (only in destination, will be kept)
[DELETE] old-backend          (only with --delete flag)
```

### Notes

- **Always use `--dry-run` first** to preview changes before modifying data
- **Use `--update` for safe incremental syncs** that preserve local-only records
- **Import order matters**: If importing examples alone, the referenced backends must already exist
- **SavedQuery is user-generated**: Avoid importing/exporting saved queries unless necessary
- **Interactive selection**: Add `--select` to pick specific records via checkbox UI

---

## License

[Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0)
