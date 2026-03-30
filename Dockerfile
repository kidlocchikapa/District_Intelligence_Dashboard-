FROM node:20-bookworm AS frontend

WORKDIR /app

COPY frontend/package*.json /app/
RUN npm install

COPY frontend /app

EXPOSE 5173

CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]

FROM node:20-bookworm AS backend

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 python3-pip python3-venv gdal-bin libgdal-dev \
    && rm -rf /var/lib/apt/lists/*

RUN python3 -m venv /opt/venv
ENV PATH="/opt/venv/bin:${PATH}"

COPY backend/package*.json /app/backend/
RUN cd /app/backend && npm ci

COPY etl/requirements.txt /app/etl/requirements.txt
RUN pip install --no-cache-dir --upgrade pip setuptools wheel \
    && pip install --no-cache-dir -r /app/etl/requirements.txt

COPY backend /app/backend
COPY etl /app/etl
COPY database /app/database
COPY sample_data /app/sample_data
COPY .env /app/.env

RUN mkdir -p /app/uploads

ENV NODE_ENV=production
ENV ETL_PYTHON_PATH=python3

EXPOSE 5000

CMD ["node", "backend/server.js"]
