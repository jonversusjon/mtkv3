# syntax=docker/dockerfile:1

# ---- Stage 1: build the React bundle -------------------------------------
# vite.config.js writes the bundle to ../flask_backend/static/react, i.e.
# /build/flask_backend/static/react in this stage.
FROM node:22-alpine AS frontend
WORKDIR /build/react-frontend
COPY react-frontend/package.json react-frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY react-frontend/ ./
RUN npm run build

# ---- Stage 2: Flask application ------------------------------------------
FROM python:3.10-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app \
    FLASK_APP=flask_backend.app:create_app

WORKDIR /app

COPY flask_backend/requirements.txt flask_backend/requirements.txt
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r flask_backend/requirements.txt

COPY . /app
# The fresh bundle always comes from the frontend stage, never from the context.
COPY --from=frontend /build/flask_backend/static/react /app/flask_backend/static/react

EXPOSE 5000

# Explicit application discovery (also set via FLASK_APP above).
CMD ["flask", "--app", "flask_backend.app:create_app", "run", "--host=0.0.0.0", "--port=5000"]
