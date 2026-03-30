# District Intelligence

District Intelligence Dashboard is a geospatial data platform for district-level decision making.  
It combines:
- A React frontend dashboard (`frontend/`)
- A Node.js API (`backend/`)
- A Python ETL and analytics pipeline (`etl/`)
- A PostGIS database (`db` service in Docker Compose)

## How To Contribute

1. Create a branch from `main`.
2. Make focused changes (one feature/fix per branch).
3. Run the project locally with Docker and verify your change.
4. Commit with clear messages.

### Branch Naming (recommended)
- `feature/<short-description>`
- `fix/<short-description>`
- `docs/<short-description>`

### Commit Message Style (recommended)
- `feat: add ward-level filter`
- `fix: handle missing coordinates in ETL`
- `docs: update container setup steps`

## Run With Containers

### Prerequisites
- Docker
- Docker Compose (v2+)

### 1) Clone and enter the project

```bash
git clone <your-repo-url>
cd "District intelligence"
```

### 2) Build and start containers

```bash
docker compose up --build -d
```

Services:
- Frontend: `http://localhost:5173`
- Backend API: `http://localhost:5000`
- PostGIS DB: host `localhost`, port `5433`

### 3) Initialize database schema

```bash
docker compose exec backend node backend/init-db.js
```

### 4) View logs (optional)

```bash
docker compose logs -f backend
docker compose logs -f frontend
docker compose logs -f db
```

### 5) Stop services

```bash
docker compose down
```

If you also want to remove volumes (including DB data):

```bash
docker compose down -v
```

## ETL Folder: Simple File Guide

`etl/` contains the extraction, transformation, loading, WorldPop integration, and analytics logic.

- `etl/main.py`  
  Main ETL entrypoint (CLI). Handles dataset type selection (`education`, `health`, `welfare`, `disaster`, `boundaries`, `worldpop`, `analysis`) and orchestrates end-to-end runs.

- `etl/ingest.py`  
  Reads input data from files or APIs. Supports CSV/Excel/JSON/GeoJSON/GPKG/SHP/ZIP, normalizes columns, and cleans missing values.

- `etl/transform.py`  
  Standardizes schemas, parses coordinates, harmonizes geography names, handles missing data strategies, builds geometries, validates boundaries/disaster polygons, and derives indicators.

- `etl/load.py`  
  Loads transformed data into PostGIS tables, converts geometries to database format, writes derived indicators, and handles helper tasks like parent boundary linking.

- `etl/worldpop.py`  
  Integrates WorldPop datasets (raster + API stats), calculates zonal population metrics, and generates population-related indicators including age/sex breakdowns.

- `etl/analytics.py`  
  Runs spatial analyses (coverage, nearest facility distance, disaster vulnerability, education/health summary metrics) and prepares outputs for `analysis_results`.

- `etl/db_utils.py`  
  Database session/engine helpers and ETL run logging into `data_load_log`.

- `etl/pipeline_config.py`  
  Central config for each dataset type: canonical column mappings, required fields, numeric coercion fields, target load columns, and indicator rules.

- `etl/requirements.txt`  
  Python dependencies required by the ETL pipeline.

## Useful ETL Commands

Run these from the project root while containers are up:

```bash
# Load boundaries first (recommended)
docker compose exec backend python3 etl/main.py --type boundaries --file sample_data/admin_units_sample.geojson

# Load education sample
docker compose exec backend python3 etl/main.py --type education --file sample_data/education_sample.csv

# Load health sample
docker compose exec backend python3 etl/main.py --type health --file sample_data/health_sample.csv
```

## Project Structure

- `frontend/` React + Vite dashboard
- `backend/` Express API routes and server logic
- `etl/` Python ETL, WorldPop, and spatial analytics
- `database/schema.sql` PostGIS schema
- `sample_data/` sample files for local ETL testing
- `docker-compose.yml` local multi-service orchestration

