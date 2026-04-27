FROM python:3.12-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    libchromaprint-tools \
    gcc \
    git \
    libsndfile1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8800

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8800", "--workers", "1", "--no-access-log"]
