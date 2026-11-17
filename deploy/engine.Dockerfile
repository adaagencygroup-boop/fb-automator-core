FROM python:3.11-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends libpq5 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt /app/requirements.txt
COPY modules/module_02_account_manager/requirements.txt /app/modules/module_02_account_manager/requirements.txt

# PyQt5 chỉ phục vụ dialog máy người dùng. API trên VPS không mở Chrome.
RUN grep -v '^PyQt5' requirements.txt > requirements.docker.txt \
    && pip install --no-cache-dir -r requirements.docker.txt

COPY . /app

EXPOSE 28129

HEALTHCHECK --interval=30s --timeout=5s --start-period=300s --retries=5 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:28129/api/health', timeout=4)"

CMD ["python", "-u", "engine.py", "--host", "0.0.0.0", "--port", "28129"]
