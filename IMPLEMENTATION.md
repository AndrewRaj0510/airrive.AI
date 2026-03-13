# Antigravity — Flight Booking Decisions
## Implementation Document

---

## 1. Project Purpose

An AI-powered flight intelligence platform that helps users decide which flight to book.
It combines **live pricing** (via SerpApi) with **scraped historical reliability data**
(via FlightRadar24) and feeds both into a **local LLM** (Ollama) to generate a structured
analyst report covering reliability, pricing, disruptions, and a final verdict.

---

## 2. Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React (Port 3000) |
| Backend API | FastAPI (Python) |
| Scraper | Playwright (headless) + playwright-stealth |
| Database | PostgreSQL |
| AI / LLM | Ollama — `gpt-oss:20b-cloud` (runs locally) |
| Live Prices | SerpApi — Google Flights engine |
| Historical Data | FlightRadar24 (web scraping) |

---

## 3. Project Structure

```
Flight_Booking_Decisions/
├── backend/
│   ├── main.py               # FastAPI app, CORS, route definitions
│   ├── fligtht_service.py    # Search logic: SerpApi fetch, DB cache, roster update
│   └── llm_service.py        # Analyze logic: scraper orchestration, DB query, Ollama call
├── scraper/
│   └── scraper.py            # Playwright headless scraper for FlightRadar24
├── database/
│   ├── schema.sql            # flights + flight_history tables
│   ├── api_schema.sql        # search_audit_logs + live_flight_searches tables
│   ├── setup_db.py           # Runs schema.sql
│   └── setup_api_db.py       # Runs api_schema.sql
└── frontend/                 # React app
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
Runs the full pipeline: scrape → aggregate → AI report.

**Request:**
```json
{ "search_id": 42 }
```

**Logic:**
1. Fetch flight IATAs from `live_flight_searches` for given `search_id`
2. **Run scraper synchronously** (`subprocess.run` — blocks until complete)
   - Scraper reads `flights` WHERE `last_scraped_at IS NULL OR DATE < TODAY`
   - Navigates FlightRadar24 headlessly, parses table rows
   - Upserts `Landed` / `Canceled` records into `flight_history`
   - Updates `last_scraped_at` in `flights` per flight
3. Query `flight_history` for 7-day aggregates: avg dep delay, avg arr delay, cancel count
4. Build Ollama payload — static system prompt (cached KV) + dynamic user prompt (fresh data)
5. POST to local Ollama API → parse JSON response
6. Return `{ report, chart_data }`

**Report Structure (JSON):**
```
report.reliability    → summary, text_table, best_time_to_fly
report.pricing        → forecast, best_booking_day, best_booking_window, trend
report.disruptions    → summary
report.verdict        → top_picks[3], final_recommendation
```

**Chart Data:**
```
chart_data.delay_chart  → per-flight: avg_dep_delay, avg_arr_delay, cancellations
chart_data.price_chart  → per-flight: price, airline, category
```

---

### `POST /api/chat`
Multi-turn chat grounded in an existing report.

**Request:**
```json
{ "report": { ...report object... }, "messages": [ {"role": "user", "content": "..."} ] }
```

**Logic:** Injects the full report as system context into Ollama `/api/chat`. The LLM answers only from data present in the report.

**Response:** `{ "reply": "..." }`

---

## 6. Scraper — How It Works

- **Gate:** Only scrapes flights where `last_scraped_at IS NULL OR DATE(last_scraped_at) < CURRENT_DATE`
- **Browser:** Playwright Chromium in **headless mode** with `playwright-stealth` to avoid bot detection
- **Target URL:** `https://www.flightradar24.com/data/flights/{iata}` (lowercase)
- **Cookie handling:** Auto-clicks accept banner if present (5s timeout, fails silently)
- **Table parsing:** Reads `table tbody tr`, skips rows with < 11 cells
- **Only records:** `Landed` and `Canceled` statuses — in-progress flights are skipped
- **Delay calculation:** Converts time strings to minutes, handles midnight crossover (±1000 min guard)
- **Conflict handling:** `ON CONFLICT (flight_iata, flight_date) DO UPDATE` — safe to re-run

---

## 7. LLM Setup — Ollama

| Setting | Value |
|---|---|
| Endpoint | `http://localhost:11434/api/generate` |
| Model | `gpt-oss:20b-cloud` |
| Format | `json` (enforced structured output) |
| keep_alive | `15m` (model stays loaded in RAM between requests) |
| System prompt | Static — enables Ollama KV cache (reduced latency on repeat calls) |
| User prompt | Dynamic — injects live + historical data per request |

---

## 8. Key Design Decisions

| Decision | Reason |
|---|---|
| Scraper runs synchronously inside `/api/analyze` | Guarantees fresh historical data before AI report is generated |
| SerpApi results cached per route+date | Avoids redundant paid API calls for same-day repeated searches |
| `flight_history` uses upsert (ON CONFLICT DO UPDATE) | Scraper is idempotent — safe to re-run without duplicating data |
| Static system prompt + dynamic user prompt | Ollama caches the large instruction block in KV; only small data payload changes per call |
| Playwright in headless mode | No browser window popup; runs silently as part of the API request lifecycle |
| Delay stored as signed integer (minutes) | Negative values correctly represent early arrivals/departures |

---

## 9. Environment Variables (`.env`)

```
DB_NAME=
DB_USER=
DB_PASSWORD=
DB_HOST=
DB_PORT=

SERPAPI_KEY=

OLLAMA_URL=http://localhost:11434/api/generate
OLLAMA_MODEL=gpt-oss:20b-cloud
```

---

## 10. Eraser Architecture Diagram Code

Paste into [eraser.io](https://eraser.io) → New Diagram → Cloud Architecture:

```
direction right

User [icon: user, color: blue]

Frontend [icon: monitor, color: blue] {
  React [label: "React App\nPort 3000"]
}

Backend [icon: server, color: orange] {
  API [icon: python, label: "FastAPI\nmain.py"]
  SearchService [icon: python, label: "fligtht_service.py\nSearch & Cache"]
  AnalyzeService [icon: python, label: "llm_service.py\nAnalyze & Report"]
}

Scraper [icon: globe, color: purple] {
  ScraperBot [icon: python, label: "scraper.py\nPlaywright Headless"]
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
  Ollama [icon: cpu, label: "Ollama (local)\nAI Report Engine"]
}

// User to Frontend
User > React: Search / Analyze / Chat

// Frontend to API
React > API: REST calls

// Search path
API > SearchService
SearchService > SerpApi: fetch live prices
SearchService > search_logs: cache check & insert
SearchService > live_searches: bulk insert results
SearchService > flights: upsert flight IATAs

// Analyze path
API > AnalyzeService
AnalyzeService > ScraperBot: subprocess.run() blocking
ScraperBot > FR24: scrape flight history
ScraperBot > flight_history: upsert daily records
ScraperBot > flights: update last_scraped_at
AnalyzeService > flight_history: 7-day aggregates
AnalyzeService > Ollama: prompt + data
Ollama > API: JSON report

// Chat path
API > Ollama: multi-turn chat
```
