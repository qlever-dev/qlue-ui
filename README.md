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

### 1. Build and run with Docker

```bash
docker compose build
docker compose up
```

Qlue-UI is now available under <http://localhost:7000>

### 2. Configuration

Endpoint configurations are defined in `config.default.yaml` (copied into the container as `config.yaml`).
To customize, mount your own `config.yaml` into the container.

### 3. Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `CONFIG_FILE` | `config.yaml` | Path to the endpoint configuration file |
| `EXAMPLES_DIR` | `examples` | Directory containing example queries |
| `DB_FILE` | `data.db` | Path to the SQLite database (shared queries) |
| `API_KEY` | *(unset)* | If set, protects write endpoints (PATCH, PUT, POST, DELETE) |
| `CORS_ORIGINS` | `*` | Comma-separated list of allowed CORS origins |

### 4. Deploying with a Proxy

The app runs behind uvicorn with `--proxy-headers` enabled, so it trusts `X-Forwarded-*` headers by default.

**Your reverse proxy MUST set these headers:**
- X-Forwarded-Host
- X-Forwarded-Proto

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
uv sync                                                      # Install dependencies
uv run fastapi dev src/api/main.py                           # Start server on port 8000
```

### Frontend Setup

```bash
cd frontend
npm install
npm run dev   # Start dev server on port 5173
```

---

## License

[Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0)
