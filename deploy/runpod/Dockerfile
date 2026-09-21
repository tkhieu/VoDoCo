# syntax=docker/dockerfile:1
FROM nvidia/cuda:12.8.1-cudnn-runtime-ubuntu24.04@sha256:9175fa92f96de35a8cfb9493f0dfcf9435c7a597e9d95ad41d2cae382a95e3f9 AS base
ENV DEBIAN_FRONTEND=noninteractive PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1
RUN apt-get update && apt-get install -y --no-install-recommends python3.12 python3.12-venv ffmpeg ca-certificates \
    && rm -rf /var/lib/apt/lists/*

FROM base AS build
COPY --from=ghcr.io/astral-sh/uv:0.12.9@sha256:3f47db7d4a0e00a2323de663864d0b75cb53e5708121f44b8add6d598be667b9 /uv /usr/local/bin/uv
ENV UV_PYTHON_DOWNLOADS=never UV_LINK_MODE=copy UV_COMPILE_BYTECODE=1
WORKDIR /opt/vodoco/inference
COPY services/inference/pyproject.toml services/inference/uv.lock ./
RUN --mount=type=cache,target=/root/.cache/uv uv sync --frozen --no-dev --no-install-project --python /usr/bin/python3.12
COPY services/inference/src ./src
RUN --mount=type=cache,target=/root/.cache/uv uv sync --frozen --no-dev --no-editable --python /usr/bin/python3.12

FROM base AS runtime
RUN useradd --create-home --uid 10001 vodoco && mkdir -p /tmp/vodoco-inference \
    && chown 10001:10001 /tmp/vodoco-inference
WORKDIR /opt/vodoco/inference
COPY --from=build /opt/vodoco/inference/.venv ./.venv
COPY --chmod=u=rX,go=rX .local/vodoco-models/release/ /opt/vodoco/models/
COPY --chmod=0444 services/inference/model-manifest.json /opt/vodoco/model-manifest.json
COPY --chmod=0444 services/inference/THIRD_PARTY_NOTICES.md /opt/vodoco/THIRD_PARTY_NOTICES.md
COPY --chmod=u=rX,go=rX services/inference/licenses/ /opt/vodoco/licenses/
ENV PATH="/opt/vodoco/inference/.venv/bin:$PATH" \
    VODOCO_MODEL_ROOT=/opt/vodoco/models \
    VODOCO_MODEL_MANIFEST=/opt/vodoco/model-manifest.json \
    VODOCO_TEMP_DIR=/tmp/vodoco-inference \
    HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1 TOKENIZERS_PARALLELISM=false \
    HF_HOME=/tmp/vodoco-hf-cache
USER 10001:10001
EXPOSE 8000
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health/live',timeout=2).read()"
CMD ["python", "-m", "uvicorn", "vodoco_inference.app:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1", "--no-access-log"]
