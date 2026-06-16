# District Intel Dashboard


District Intel Dashboard is an integrated district-planning intelligence platform for visualising population, education, health, social welfare, and disaster-risk data. It helps planners identify underserved communities, exposed facilities, and cross-sector priorities using interactive maps, graphs, indicators, and evidence-based recommendations.

The current implementation is designed around Zomba and Zomba City, with a structure that can be extended to other districts where comparable administrative, facility, population, and hazard datasets are available.

---

## Table of Contents

- [Tech Stack](#tech-stack)
- [Features](#features)
- [Demo](#demo)
- [Project Structure](#project-structure)
- [Installation](#installation)
- [Usage](#usage)
- [Environment Variables](#environment-variables)
- [API Documentation](#api-documentation)
- [Data and Spatial Processing](#data-and-spatial-processing)
- [Quality Checks](#quality-checks)
- [Roadmap](#roadmap)
- [Contributing](#contributing)
- [Authors](#authors)
- [Acknowledgements](#acknowledgements)

---

## Tech Stack

| Layer | Technologies |
|---|---|
| Frontend | React, Vite, Tailwind CSS, Recharts, Leaflet, React Leaflet |
| Backend | Node.js, Express, PostgreSQL client, Joi, JWT, Swagger |
| Database | PostgreSQL, PostGIS, pgRouting |
| ETL / Spatial Analysis | Python, Pandas, GeoPandas, Rasterio, SQLAlchemy, GeoAlchemy2 |
| Reporting | jsPDF, html2canvas, html-to-image |
| DevOps | Docker, Docker Compose |

---

## Features

- District and TA-level planning dashboards
- Interactive raster maps for population, education access, health access, and flood exposure
- Hover and click map interactions for TA-level details and page-wide filtering
- Searchable, sortable, and filterable charts for high-volume planning indicators
- Education analytics covering schools, infrastructure pressure, access, and flood impact
- Health analytics covering facility coverage, access, workforce pressure, TA vulnerability, and facility burden
- Social welfare analytics for beneficiary distribution and service-intersection planning
- Disaster-risk analytics for exposed population, flood-affected schools, health facilities, and risk recommendations
- Integrated recommendations with metric preview modals for transparent evidence
- Public RAG-backed AI planner with cited sources, metric-specific insights, and report drafting
- Planning document ingestion for district policies, case notes, and best-practice guidance
- PDF/report export support for selected analysis areas
- Swagger/OpenAPI documentation for backend routes
- Docker-based local development environment with frontend, backend, and PostGIS database

---

## Demo

**Live Demo:** https://district-intelligence-dashboard.vercel.app

---

## Project Structure

```text
District_Intelligence_Dashboard-
├── backend/        Express API, authentication, routes, Swagger docs
├── database/       PostGIS schema, migrations, and database Docker setup
├── etl/            Python geospatial ETL and analytics scripts
├── frontend/       React + Vite dashboard application
├── sample_data/    Example/import datasets
├── scripts/        Utility scripts such as raster preview generation
├── uploads/        Uploaded datasets and generated artifacts
├── Dockerfile      Multi-stage frontend/backend Docker image
├── docker-compose.yml
└── README.md
```

**Frontend:**

```text
frontend/src
├── Pages/          Dashboard pages by department
├── components/     Reusable UI, maps, tables, charts, and modals
├── context/        Shared district/TA selection state
├── hooks/          Data fetching and PDF/export helpers
├── lib/            Formatting, query, and geospatial utilities
└── main.jsx        React application entry point
```

**Backend:**

```text
backend/
├── routes/         API route modules
├── helpers/        Shared backend helper utilities
├── server.js       Express server entry point
├── swagger.js      OpenAPI/Swagger configuration
└── init-db.js      Database initialization helper
```

---

## Installation

### Option 1: Docker (Recommended)

1. Clone the repository:

```bash
git clone <repository-url>
cd District_Intelligence_Dashboard-
```

2. Create a local environment file:

```bash
cp .env.example .env
```

> **Windows PowerShell:**
> ```powershell
> Copy-Item .env.example .env
> ```

3. Start all services:

```bash
docker compose up --build
```

4. Open the application:

| Service | URL |
|---|---|
| Frontend | http://localhost:5173 |
| Backend API | http://localhost:5000 |
| Swagger Docs | http://localhost:5000/api-docs |

---

### Option 2: Manual Local Setup

**Backend:**

```bash
cd backend
npm install
npm run dev
```

**Frontend** (in a separate terminal):

```bash
cd frontend
npm install
npm run dev
```

**ETL environment** (only if running Python data-processing scripts):

```bash
# macOS / Linux
cd etl
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

```bash
# Windows
cd etl
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
```

---

## Usage

### Run the Full Application

```bash
docker compose up --build
```

Then visit `http://localhost:5173`.

### Frontend Commands

```bash
cd frontend
npm run dev       # Start development server
npm run build     # Build for production
npm run preview   # Preview production build
```

### Backend Commands

```bash
cd backend
npm run dev   # Start with hot reload
npm start     # Start in normal Node mode
```

### Example Workflow

1. Select a district or TA using the shared selector
2. Review headline indicators on the current department page
3. Hover over a map area to inspect local metrics
4. Click a TA on the map or chart to focus the dashboard
5. Use chart filters, sorting, and search to narrow analysis
6. Open recommendation metric previews to inspect evidence records
7. Click Ask AI from a recommendation or metric preview to generate cited planning guidance
8. Export area analysis or AI-written report sections when needed

---

## Environment Variables

Create `.env` from `.env.example` and configure values for your environment.

> **Never commit production credentials or private deployment secrets.**

| Variable | Description | Example |
|---|---|---|
| `PORT` | Backend API port | `5000` |
| `DATABASE_URL` | Optional full PostgreSQL connection string | Leave blank for local Docker DB |
| `DB_HOST` | Database host | `db` |
| `DB_PORT` | Database port | `5432` |
| `DB_NAME` | Database name | `district_intelligence` |
| `DB_USER` | Database username | `district_user` |
| `DB_PASSWORD` | Database password | `district_password` |
| `JWT_SECRET` | Secret for signing JWT tokens | Use a strong private value |
| `JWT_EXPIRES_IN` | JWT expiry duration | `1d` |
| `BCRYPT_ROUNDS` | Password hashing rounds | `12` |
| `CORS_ALLOWED_ORIGINS` | Comma-separated frontend origins allowed by the API | `http://localhost:5173` |
| `RAG_DOCUMENTS_DIR` | Directory of planning documents to sync during ETL runs | `sample_data/planning_docs` |
| `AI_LLM_PROVIDER` | LLM provider for RAG answers | `openai`, `ollama`, or `hash` fallback |
| `AI_LLM_MODEL` | LLM model name used by the AI planner | `gpt-4o-mini` |
| `AI_EMBEDDING_PROVIDER` | Embedding provider for document/query vectors | `openai`, `ollama`, or `hash` fallback |
| `AI_EMBEDDING_MODEL` | Embedding model name used for indexing and retrieval | `text-embedding-3-small` |
| `AI_LLM_TIMEOUT_MS` | Max time allowed for LLM generation | `4000` |
| `AI_EMBEDDING_TIMEOUT_MS` | Max time allowed for embedding generation | `2500` |
| `OPENAI_API_KEY` | Optional OpenAI API key for hosted models | `sk-...` |
| `OLLAMA_BASE_URL` | Optional Ollama server URL | `http://localhost:11434` |

---

## API Documentation

When the backend is running, Swagger documentation is available at:

```
http://localhost:5000/api-docs
```

The OpenAPI JSON specification is available at:

```
http://localhost:5000/api-docs.json
```

### AI endpoints

The planning assistant adds these authenticated routes:

| Method | Route | Access | Purpose |
|---|---|---|---|
| `POST` | `/api/ai/query` | Public | Ask a natural language planning question with district/TA context |
| `POST` | `/api/ai/recommendations` | Public | Generate context-aware recommendations from retrieved evidence |
| `POST` | `/api/ai/insights/:metricId` | Public | Generate metric-specific planning insights |
| `POST` | `/api/ai/report` | Public | Draft AI-written report sections for export |
| `GET` | `/api/ai/documents/:documentId` | Public | Inspect a stored planning document and its indexed chunks |
| `POST` | `/api/ai/documents/upload` | Admin only | Upload and index a planning document |
| `POST` | `/api/ai/documents` | Admin only | Create or update a planning document from raw content |

---

## Data and Spatial Processing

The dashboard relies on a PostGIS-enabled spatial database and Python ETL scripts.

**Core responsibilities:**

- Load administrative boundaries, facility records, population data, welfare data, and flood-risk data
- Transform tabular and geospatial records into dashboard-ready structures
- Generate raster previews for browser-based map display
- Link flood exposure with population, schools, health facilities, and welfare indicators
- Generate TA-level and district-level summaries for planning dashboards
- Sync planning documents and RAG chunks into PostgreSQL for AI retrieval
- Support optional pgvector-backed similarity search when the extension is available

**Key ETL files:**

| File | Purpose |
|---|---|
| `etl/main.py` | Main ETL entry point |
| `etl/ingest.py` | Data ingestion |
| `etl/transform.py` | Data transformation |
| `etl/load.py` | Database loading |
| `etl/worldpop.py` | Population raster processing |
| `etl/flood_exposure.py` | Flood exposure analysis |
| `etl/health_access.py` | Health access analysis |
| `etl/welfare.py` | Welfare integration processing |
| `etl/rag_index.py` | Planning document ingestion and RAG sync |
| `scripts/generate_worldpop_preview.py` | Raster preview utility |

---

## Quality Checks

Run these checks before committing or submitting work.

**Build check:**

```bash
cd frontend
npm run build
```

**Targeted lint check:**

```bash
cd frontend
npx eslint src/components/PopulationRasterPanel.jsx
```

**Backend startup check:**

```bash
cd backend
npm start
```

> **Note:** The project may contain existing lint debt outside recently edited files. Use targeted linting when working on focused changes.

---

## Roadmap

Planned improvements for upcoming iterations:

- Add final production deployment documentation
- Add screenshots and a hosted demo link
- Expand support for additional districts beyond Zomba and Zomba City
- Improve role-based access control flows for administrative users
- Add automated tests for backend routes and key frontend interactions
- Add CI checks for build, lint, and migration validation
- Improve large bundle splitting for frontend production builds
- Add more detailed metadata documentation for raster and ETL outputs

---

## Contributing

Contributions should be focused, tested, and easy to review.

**Workflow:**

1. Create a feature branch:

```bash
git checkout -b feature/short-description
```

2. Make focused changes and run relevant checks:

```bash
cd frontend
npm run build
```

3. Commit with a clear message:

```bash
git commit -m "feat(area): short summary"
```

4. Open a pull request or submit the branch for review.

**Guidelines:**

- Keep shared UI behaviour in reusable components where possible
- Avoid committing generated files, build output, `node_modules`, virtual environments, or secrets
- Use clear commit messages — `feat(health): ...`, `fix(map): ...`, `refactor(ui): ...`
- Document any new environment variables, endpoints, or data assumptions

---

## Authors

Developed by **Group 18 — UNIMA Final Year Students (2025/2026)**:

- Kidloc Chikapa - Project Lead
- Lucy Sabola
- Sydney Mtima
- Precious Pukulu

**Supervisors:**
- Dr. Kondwani Munthali *(Main Supervisor)*
- Mr. Macdonald Mwamlima *(Assistant Supervisor)*

---

## Acknowledgements

This project uses and benefits from the following open-source tools and libraries:

- [React](https://react.dev) and [Vite](https://vitejs.dev) — frontend application
- [Leaflet](https://leafletjs.com) and [React Leaflet](https://react-leaflet.js.org) — interactive maps
- [Recharts](https://recharts.org) — charts and visual analytics
- [Express](https://expressjs.com) — backend API
- [PostgreSQL](https://www.postgresql.org), [PostGIS](https://postgis.net), and [pgRouting](https://pgrouting.org) — spatial data management
- [GeoPandas](https://geopandas.org), [Rasterio](https://rasterio.readthedocs.io), [Pandas](https://pandas.pydata.org), [SQLAlchemy](https://www.sqlalchemy.org), and [GeoAlchemy2](https://geoalchemy-2.readthedocs.io) — geospatial ETL
- [Swagger/OpenAPI](https://swagger.io) — API documentation
- [Docker](https://www.docker.com) and [Docker Compose](https://docs.docker.com/compose) — local development orchestration

The planning concept is informed by integrated district development workflows, geospatial service-access analysis, and disaster-risk decision support.
