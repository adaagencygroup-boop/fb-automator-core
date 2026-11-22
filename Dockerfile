FROM python:3.12-slim-bookworm AS builder
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_DISABLE_PIP_VERSION_CHECK=1
WORKDIR /build
RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"
COPY server.txt /tmp/server.txt
RUN --mount=type=cache,target=/root/.cache/pip pip install --prefer-binary -r /tmp/server.txt
FROM python:3.12-slim-bookworm AS runtime
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 MALLOC_ARENA_MAX=2 PATH="/opt/venv/bin:$PATH"
WORKDIR /app
LABEL org.opencontainers.image.source="https://github.com/adaagencygroup-boop/fb-automator-core"
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates libpq5 && rm -rf /var/lib/apt/lists/*
COPY --from=builder /opt/venv /opt/venv
COPY config ./config
COPY core ./core
COPY modules ./modules
COPY engine.py ./engine.py
RUN mkdir -p /app/data /app/logs /app/downloads /app/uploads
EXPOSE 28129
CMD ["python", "-u", "engine.py", "--host", "0.0.0.0", "--port", "28129"]