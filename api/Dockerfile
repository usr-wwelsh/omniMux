FROM python:3.12-slim AS builder

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    git \
    && rm -rf /var/lib/apt/lists/*

RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

ARG TARGETARCH
ARG FPCALC_VERSION=1.5.1
ARG FPCALC_SHA256=4d7433a7f778e5946d7225230681cbcd634e153316ecac87c538c33ac32387a5
RUN mkdir /fpcalc \
    && if [ "$TARGETARCH" = "amd64" ]; then \
        curl -fsSL -o fpcalc.tar.gz "https://github.com/acoustid/chromaprint/releases/download/v${FPCALC_VERSION}/chromaprint-fpcalc-${FPCALC_VERSION}-linux-x86_64.tar.gz" \
        && echo "${FPCALC_SHA256}  fpcalc.tar.gz" | sha256sum -c - \
        && tar -xzf fpcalc.tar.gz --strip-components=1 -C /fpcalc "chromaprint-fpcalc-${FPCALC_VERSION}-linux-x86_64/fpcalc"; \
    fi

FROM python:3.12-slim

ARG TARGETARCH
RUN apt-get update && apt-get install -y --no-install-recommends \
    quickjs \
    $([ "$TARGETARCH" = "amd64" ] || echo libchromaprint-tools) \
    && rm -rf /var/lib/apt/lists/*

COPY --from=mwader/static-ffmpeg@sha256:a8090df5f5608daef387e1b2e93b98aaacb4d92153ad904e7d715c725724fca4 /ffmpeg /ffprobe /usr/local/bin/
COPY --from=builder /fpcalc/ /usr/local/bin/
COPY --from=builder /opt/venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

WORKDIR /app
COPY . .

EXPOSE 8800

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8800", "--workers", "1", "--no-access-log"]
