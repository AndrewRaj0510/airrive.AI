# Antigravity — Flight Booking Decisions
## Implementation Document

---

## 1. Project Purpose

An AI-powered flight intelligence platform that helps users decide which flight to book.
It combines **live pricing** (via SerpApi) with **scraped historical reliability data**
(via FlightRadar24) and feeds both into **Groq AI** (cloud LLM) to generate a structured
analyst report covering reliability, pricing, disruptions, and a final verdict.

---

## 2. Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 14 — deployed on **Vercel** |
| Backend API | FastAPI (Python) — deployed on **Render** |
| Scraper | Playwright (headless) + playwright-stealth — run **manually** |
| Database | **Supabase** (PostgreSQL, cloud-hosted) |
| AI / LLM | **Groq API** — `llama-3.3-70b-versatile` |
| Live Prices | SerpApi — Google Flights engine |
| Historical Data | FlightRadar24 (web scraping) |

---

## 3. Project Structure

```
Flight_Booking_Decisions/
├── backend/
│   ├── main.py               # FastAPI app, CORS, route definitions
│   ├── fligtht_service.py    # Search logic: SerpApi fetch, DB cache, roster update
│   └── llm_service.py        # Analyze logic: DB query, Groq AI call
├── scraper/
│   └── scraper.py            # Playwright headless scraper for FlightRadar24 (manual)
├── database/
│   ├── schema.sql            # flights + flight_history tables
│   ├── api_schema.sql        # search_audit_logs + live_flight_searches tables
│   ├── setup_db.py           # Runs schema.sql
│   └── setup_api_db.py       # Runs api_schema.sql
├── frontend/                 # Next.js app
├── docker-compose.yml        # Local Docker setup (backend + frontend)
└── .env                      # Environment variables
```

---

## 4. Database Schema

### `flights` — The Tracker Roster
Stores every unique flight IATA that the system tracks.

| Column | Type | Notes |
|---|---|---|
| flight_iata | VARCHAR(10) PK | e.g. `6E123` |
| airline | VARCHAR(100) | |
| origin | VARCHAR(3) | IATA airport code |
| destination | VARCHAR(3) | IATA airport code |
| last_scraped_at | TIMESTAMP | NULL = never scraped; controls daily scrape gate |

### `flight_history` — Daily Reliability Log
One row per flight per day. Written by the scraper.

| Column | Type | Notes |
|---|---|---|
| id | SERIAL PK | |
| flight_iata | VARCHAR(10) FK → flights | |
| flight_date | DATE | Unique together with flight_iata |
| origin / destination | VARCHAR(3) | As scraped (catches diversions) |
| aircraft | VARCHAR(100) | e.g. `A320-251N` |
| flight_time | VARCHAR(20) | e.g. `1h 45m` |
| std / atd / sta / ata | VARCHAR(10) | Scheduled/Actual departure/arrival times |
| status | VARCHAR(100) | `Landed` or `Canceled` |
| departure_delay | INTEGER | Minutes. Negative = early |
| arrival_delay | INTEGER | Minutes. Negative = early |

**Constraint:** `UNIQUE (flight_iata, flight_date)` — prevents duplicates; upserts on conflict.

### `search_audit_logs` — Search Event Log
One row per user search. Used as the cache deduplication key.

| Column | Type | Notes |
|---|---|---|
| search_id | SERIAL PK | |
| search_timestamp | TIMESTAMP | Default now() |
| origin / destination | VARCHAR(3) | |
| flight_date | DATE | |
| trip_type | VARCHAR(50) | `One-way` or `Round trip` |

### `live_flight_searches` — SerpApi Results Cache
Flattened SerpApi results linked to a search event.

| Column | Type | Notes |
|---|---|---|
| result_id | SERIAL PK | |
| search_id | INTEGER FK → search_audit_logs | |
| category | VARCHAR(50) | `best_flights` or `other_flights` |
| dep_iata / arrival_iata | VARCHAR(10) | |
| departure_time / arrival_time | VARCHAR(50) | |
| price | DECIMAL(10,2) | In INR |
| airline_name | VARCHAR(255) | May be multi-airline e.g. `ANA, United` |
| flight_number | VARCHAR(50) | Primary leg IATA e.g. `6E 123` |
| connecting_flight_numbers | TEXT | Comma-separated e.g. `NH 126, UA 2175` |
| duration_mins / layover_dur_mins / stops | INTEGER | |

---

## 5. API Endpoints

### `POST /api/search`
Fetches live flights and caches them. Returns instantly if same route was searched today.

**Request:**
```json
{ "origin": "DEL", "destination": "BOM", "outbound_date": "2026-03-20", "return_date": null }
```

**Logic:**
1. Cache check — if `search_audit_logs` has same route + date today, return cached `live_flight_searches`
2. Call SerpApi → flatten to 15-column schema → bulk insert into `live_flight_searches`
3. Upsert all flight IATAs into `flights` tracker (ON CONFLICT DO NOTHING)
4. Return `{ search_id, best_flights[], other_flights[] }` sorted by price

**Response:**
```json
{ "search_id": 42, "best_flights": [...], "other_flights": [...] }
```

---

### `POST /api/analyze`
Queries historical data and generates an AI report via Groq.

**Request:**
```json
{ "search_id": 42 }
```

**Logic:**
1. Fetch live flights from `live_flight_searches` for the given `search_id`
2. Query `flight_history` for 7-day aggregates: avg dep delay, avg arr delay, cancel count
3. Build Groq prompt — static system prompt + dynamic user prompt (live + historical data)
4. Call Groq API → parse plain-text response
5. Return `{ report }`

**Report Structure (plain text, 4 sections):**
```
**Reliability & Delay Trends**
**Pricing Forecast & Booking Window**
**Real-World Impact & Disruptions**
**The Smart Booking Verdict**
```

---

### `POST /api/chat`
Multi-turn chat grounded in an existing report.

**Request:**
```json
{ "report": { ...report object... }, "messages": [ {"role": "user", "content": "..."} ] }
```

**Logic:** Injects the full report as system context into Groq. The LLM answers only from data present in the report.

**Response:** `{ "reply": "..." }`

---

## 6. Scraper — How It Works

- **Trigger:** Run **manually** (`python scraper/scraper.py`) to populate `flight_history`
- **Gate:** Only scrapes flights where `last_scraped_at IS NULL OR DATE(last_scraped_at) < CURRENT_DATE`
- **Browser:** Playwright Chromium in **headless mode** with `playwright-stealth` to avoid bot detection
- **Target URL:** `https://www.flightradar24.com/data/flights/{iata}` (lowercase)
- **Cookie handling:** Auto-clicks accept banner if present (5s timeout, fails silently)
- **Table parsing:** Reads `table tbody tr`, skips rows with < 11 cells
- **Only records:** `Landed` and `Canceled` statuses — in-progress flights are skipped
- **Delay calculation:** Converts time strings to minutes, handles midnight crossover (±1000 min guard)
- **Conflict handling:** `ON CONFLICT (flight_iata, flight_date) DO UPDATE` — safe to re-run

---

## 7. LLM Setup — Groq

| Setting | Value |
|---|---|
| Provider | Groq API (cloud) |
| Model | `llama-3.3-70b-versatile` |
| Output format | Plain text (4 structured sections) |
| System prompt | Static instruction block |
| User prompt | Dynamic — injects live + historical data per request |
| Free tier limits | 1,000 req/day, 6,000 tokens/min |

---

## 8. Deployment

| Service | Platform | Notes |
|---|---|---|
| Frontend | Vercel | Auto-deploys from `main` branch; Root Directory = `frontend` |
| Backend | Render | Native Python runtime; Root Directory = `backend`; auto-deploys from `main` |
| Database | Supabase | Hosted PostgreSQL; connect via pooler for IPv4 compatibility with Render free tier |

**Keep Render awake:** Use [UptimeRobot](https://uptimerobot.com) to ping `https://airrive-ai.onrender.com/docs` every 5 minutes (free tier spins down after 15 min inactivity).

---

## 9. Key Design Decisions

| Decision | Reason |
|---|---|
| Groq instead of Ollama | Ollama requires local GPU/CPU and can't be cloud-deployed; Groq is free, fast, and cloud-based |
| Scraper runs manually | Playwright can't run on Render free tier (no Chromium); historical data populated locally |
| Supabase pooler (not direct connection) | Render free tier only supports IPv4; Supabase direct connection resolves to IPv6 |
| SerpApi results cached per route+date | Avoids redundant paid API calls for same-day repeated searches |
| `flight_history` uses upsert (ON CONFLICT DO UPDATE) | Scraper is idempotent — safe to re-run without duplicating data |
| CORS via `ALLOWED_ORIGINS` env var | Allows different origins per environment without code changes |
| Delay stored as signed integer (minutes) | Negative values correctly represent early arrivals/departures |

---

## 10. Environment Variables (`.env`)

```
DB_NAME=postgres
DB_USER=postgres
DB_PASSWORD=
DB_HOST=db.ynclnhbogitklqvsektu.supabase.co   # direct (local use)
DB_PORT=5432

SERPAPI_KEY=
GROQ_API_KEY=
```

**For Render (use Supabase pooler):**
```
DB_HOST=aws-1-ap-northeast-1.pooler.supabase.com
DB_USER=postgres.ynclnhbogitklqvsektu
DB_PORT=5432
ALLOWED_ORIGINS=https://airrive-ai.vercel.app
```

---

## 11. Eraser Architecture Diagram Code

Paste into [eraser.io](https://eraser.io) → New Diagram → Cloud Architecture:

```
direction right

User [icon: user, color: blue]

Frontend [icon: monitor, color: blue] {
  NextJS [label: "Next.js 14\nVercel"]
}

Backend [icon: server, color: orange] {
  API [icon: python, label: "FastAPI\nmain.py"]
  SearchService [icon: python, label: "fligtht_service.py\nSearch & Cache"]
  AnalyzeService [icon: python, label: "llm_service.py\nAnalyze & Report"]
}

Scraper [icon: globe, color: purple] {
  ScraperBot [icon: python, label: "scraper.py\nPlaywright Headless\n(manual run)"]
}

Database [icon: database, color: green] {
  flights [icon: table, label: "flights\nTracker Roster"]
  flight_history [icon: table, label: "flight_history\nDelays & Cancels"]
  search_logs [icon: table, label: "search_audit_logs\nCache Keys"]
  live_searches [icon: table, label: "live_flight_searches\nSerpApi Cache"]
}

External [icon: cloud, color: red] {
  SerpApi [icon: search, label: "SerpApi\nLive Prices (INR)"]
  FR24 [icon: plane, label: "FlightRadar24\nHistorical Data"]
  Groq [icon: cpu, label: "Groq API\nllama-3.3-70b-versatile"]
  Supabase [icon: database, label: "Supabase\nPostgreSQL (cloud)"]
}

// User to Frontend
User > NextJS: Search / Analyze / Chat

// Frontend to API
NextJS > API: REST calls

// Search path
API > SearchService
SearchService > SerpApi: fetch live prices
SearchService > search_logs: cache check & insert
SearchService > live_searches: bulk insert results
SearchService > flights: upsert flight IATAs

// Analyze path
API > AnalyzeService
AnalyzeService > flight_history: 7-day aggregates
AnalyzeService > Groq: prompt + data
Groq > API: plain-text report

// Scraper (manual)
ScraperBot > FR24: scrape flight history
ScraperBot > flight_history: upsert daily records
ScraperBot > flights: update last_scraped_at

// Database (Supabase)
SearchService > Supabase
AnalyzeService > Supabase
ScraperBot > Supabase

// Chat path
API > Groq: multi-turn chat
```
