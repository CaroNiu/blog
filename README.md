# Personal Blog System (FastAPI)

A monolith REST API implementation of the provided Personal Blog System specification.

## Features

- JWT authentication (`/api/v1/auth/register`, `/api/v1/auth/login`)
- Public article list/detail endpoints
- Admin article CRUD (soft delete)
- Nested comments for published articles
- SQLite-backed persistence via SQLAlchemy

## Run locally

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

Open docs at `http://127.0.0.1:8000/docs`.

## Run tests

```bash
pytest -q
```
