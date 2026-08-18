# syntax=docker/dockerfile:1.7

FROM python:3.11-slim AS builder

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /build

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      build-essential \
      gcc \
      curl && \
    rm -rf /var/lib/apt/lists/*

COPY requirements.txt ./

RUN python -m venv /opt/venv && \
    /opt/venv/bin/pip install --upgrade \
      pip \
      "setuptools>=78.1.1" \
      "wheel>=0.46.2" && \
    /opt/venv/bin/pip install --no-cache-dir -r requirements.txt


FROM python:3.11-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PATH="/opt/venv/bin:$PATH"

WORKDIR /app

RUN apt-get update && \
    apt-get upgrade -y && \
    apt-get install -y --no-install-recommends \
      curl \
      libglib2.0-0 \
      libgl1 \
      libgomp1 && \
    rm -rf /var/lib/apt/lists/*

# Remove vulnerable packaging tools shipped in the base image.
RUN rm -rf \
    /usr/local/lib/python3.11/site-packages/pip \
    /usr/local/lib/python3.11/site-packages/pip-*.dist-info \
    /usr/local/lib/python3.11/site-packages/setuptools \
    /usr/local/lib/python3.11/site-packages/setuptools-*.dist-info \
    /usr/local/lib/python3.11/site-packages/wheel \
    /usr/local/lib/python3.11/site-packages/wheel-*.dist-info \
    /usr/local/bin/pip \
    /usr/local/bin/pip3 \
    /usr/local/bin/pip3.*

RUN groupadd --system quotii && \
    useradd --system --gid quotii quotii

COPY --from=builder /opt/venv /opt/venv

# pip is not required at runtime.
RUN rm -rf \
    /opt/venv/lib/python3.11/site-packages/pip \
    /opt/venv/lib/python3.11/site-packages/pip-*.dist-info \
    /opt/venv/bin/pip \
    /opt/venv/bin/pip3 \
    /opt/venv/bin/pip3.*

COPY . .

RUN chown -R quotii:quotii /app

USER quotii

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
    CMD curl --fail http://127.0.0.1:8000/health || exit 1

CMD ["python", "-m", "uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000"]