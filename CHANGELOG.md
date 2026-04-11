# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.1] - 2026-04-11

### Fixed

- SPA fallback now correctly catches Starlette's `HTTPException`, so client-side routes (e.g. `/wikidata`) serve `index.html` instead of returning a JSON 404

## [0.2.0] - 2026-04-10

### Changed

- Replaced legacy Django backend with FastAPI
- Updated Docker setup for FastAPI backend
- Bumped Python version to 3.14
- Replaced TextMate grammar with LSP semantic tokens for syntax highlighting

### Added

- Structured logging to startup using uvicorn's logger

### Removed

- TextMate grammar (`sparql.tmLanguage.json`) and `@codingame/monaco-vscode-textmate-service-override` dependency
