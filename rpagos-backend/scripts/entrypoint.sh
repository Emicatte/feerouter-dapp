#!/bin/sh
set -e

echo "[entrypoint] running alembic upgrade head"
alembic upgrade head

echo "[entrypoint] starting uvicorn on port ${PORT:-8000}"
exec uvicorn app.main:app --host 0.0.0.0 --port "${PORT:-8000}" --workers 1
