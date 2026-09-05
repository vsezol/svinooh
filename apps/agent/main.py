"""Entrypoint, and nothing else.

Everything real lives in app/ — config, the model seam, sessions, routes. This
file only assembles them, so `uvicorn main:app` stays the one command the
Dockerfile needs while the service underneath keeps growing.
"""
from app import create_app

app = create_app()
