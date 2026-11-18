FROM python:3.12-bookworm
ENV PYTHONDONTWRITEBYTECODE=1 \
  PYTHONUNBUFFERED=1 \
  PIP_DISABLE_PIP_VERSION_CHECK=1
WORKDIR /app
LABEL org.opencontainers.image.source="https://github.com/adaagencygroup-boop/fb-automator-core"
RUN apt-get update \
  && apt-get install -y --no-install-recommends libpq5 ffmpeg postgresql-client \
  && rm -rf /var/lib/apt/lists/*
COPY requirements.txt /app/requirements.txt
COPY modules/module_02_account_manager/requirements.txt /app/modules/module_02_account_manager/requirements.txt
RUN grep -iEv '^pyqt' requirements.txt > requirements.docker.txt \
  && pip install --no-cache-dir -r requirements.docker.txt \
  && rm -f requirements.docker.txt
COPY . /app
RUN mkdir -p /app/data /app/logs /app/downloads /app/uploads
EXPOSE 28129
ENTRYPOINT ["/bin/sh", "-c", "mkdir -p /app/data /app/logs /app/downloads /app/uploads && chmod -R 777 /app/data /app/logs /app/downloads /app/uploads && exec python -u engine.py --host 0.0.0.0 --port 28129"]