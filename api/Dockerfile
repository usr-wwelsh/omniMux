FROM python:3.12-slim AS builder

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
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

ARG MOOD_VERSION=0.1.0
ARG MOOD_SHA256_AMD64=0dad7e51f709dae69d78b687c9042af668761a82c9af08eae789592bf0dd7dd0
ARG MOOD_SHA256_ARM64=8fcd00eb59455f478e69771ba7780e65ec28d2febd2563591d280d89502b91a3
RUN case "$TARGETARCH" in \
        amd64) sha="$MOOD_SHA256_AMD64" ;; \
        arm64) sha="$MOOD_SHA256_ARM64" ;; \
        *) echo "unsupported arch: $TARGETARCH" >&2; exit 1 ;; \
    esac \
    && mkdir /mood \
    && curl -fsSL -o /mood/mood "https://github.com/usr-wwelsh/Mood-Detector/releases/download/v${MOOD_VERSION}/mood-linux-${TARGETARCH}" \
    && echo "${sha}  /mood/mood" | sha256sum -c - \
    && chmod 755 /mood/mood

FROM python:3.12-slim

ARG TARGETARCH
RUN apt-get update && apt-get install -y --no-install-recommends \
    quickjs \
    $([ "$TARGETARCH" = "amd64" ] || echo libchromaprint-tools) \
    && rm -rf /var/lib/apt/lists/*

COPY --from=mwader/static-ffmpeg@sha256:a8090df5f5608daef387e1b2e93b98aaacb4d92153ad904e7d715c725724fca4 /ffmpeg /ffprobe /usr/local/bin/
COPY --from=builder /fpcalc/ /usr/local/bin/
COPY --from=builder /mood/mood /usr/local/bin/mood
COPY --from=builder /opt/venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

WORKDIR /app
COPY . .

EXPOSE 8800

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8800", "--workers", "1", "--no-access-log"]
