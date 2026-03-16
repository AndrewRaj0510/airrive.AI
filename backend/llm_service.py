import os
import json
import psycopg2
from groq import Groq
from dotenv import load_dotenv
from datetime import datetime, timedelta
from collections import defaultdict

load_dotenv()

DB_CONFIG = {
    "dbname": os.getenv("DB_NAME"),
    "user": os.getenv("DB_USER"),
    "password": os.getenv("DB_PASSWORD"),
    "host": os.getenv("DB_HOST"),
    "port": os.getenv("DB_PORT"),
    "sslmode": "require"
}

GROQ_MODEL = os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile")
client = Groq(api_key=os.getenv("GROQ_API_KEY"))


def _fmt_delay_field(label: str, m: float) -> str:
    """Returns 'label: Xm' for delays/on-time, 'Arrived Xm early' for early arrivals."""
    m_abs = int(round(abs(m)))
    h, mm = divmod(m_abs, 60)
    time_str = f"{h}h {mm}m" if h else f"{mm}m"
    if m < 0:
        return f"Arrived {time_str} early"
    return f"{label}: {time_str}"

SYSTEM_PROMPT = """You are Airrive AI, a conversational flight assistant. Output the flight summary in EXACTLY this format. Every section heading must be on its own line wrapped in ** as shown. No other asterisks anywhere. No bullet points. No extra text before or after.

**Flight Analysis: [ORIGIN] → [DESTINATION]**
[HISTORY_START] – [HISTORY_END]

**Summary**
Flights available: [count of live flights]
Route: [ORIGIN] → [DESTINATION]
Airlines: [comma-separated unique airline names]
Flights tracked historically: [total historically tracked]
On-time: [on-time count] / [total historically tracked]
Delayed: [delayed count] / [total historically tracked]
Avg punctuality: [average time difference in minutes] mins
Total schedule impact: [sum of all time differences in Xh Ym format]

**What Stood Out**
[Specific observation — one sentence, name actual flight numbers and airlines]
[Another specific observation — short sentence]
[Another specific observation — short sentence]

**Travel Tip**
[One concrete recommendation based on the data, naming specific flights or times]

**Would you like:**
1. See Recommended Flights
2. Delay Pattern Report
3. Best Time to Fly Report
4. Airport Reliability Report

Rules:
- Output only the format above, nothing else before or after
- Section headings must be exactly as shown, wrapped in **, on their own line, nothing else on that line
- Use only the flights fetched by the backend. No extra flights.
- Always name actual airline names and flight numbers in observations
- Use the exact HISTORY_START and HISTORY_END dates provided in the user prompt for the date line — do not use today's date or the live flight departure dates
- A flight is on-time if avg_arrival_variance_mins <= 5; otherwise it is delayed
- If historical data is empty, set on-time/delayed to N/A and base observations on live pricing and timing only
- Never use the phrase "arrival delay". If a flight arrived before its scheduled time, say "arrived early" or "arrived X mins early"
- Never present any time value as a negative number. Early arrivals are always expressed as positive minutes/hours with the word "early\""""


def analyze_flights(search_id: int):
    conn = None
    try:
        conn = psycopg2.connect(**DB_CONFIG)
        cursor = conn.cursor()

        # 1. Fetch live flights + route info from the search cache
        cursor.execute("""
            SELECT flight_number, price, departure_time, arrival_time, airline_name, category,
                   dep_iata, arrival_iata
            FROM live_flight_searches
            WHERE search_id = %s;
        """, (search_id,))

        live_flights = cursor.fetchall()

        if not live_flights:
            return {"error": f"No flights found for search_id {search_id}"}

        # 2. Build live data list and extract the route
        dep_iata = live_flights[0][6]
        arrival_iata = live_flights[0][7]

        live_data_for_llm = []
        for f in live_flights:
            clean_iata = f[0].replace(" ", "").upper()
            live_data_for_llm.append({
                "flight_iata": clean_iata,
                "price_inr": float(f[1]),
                "departure": str(f[2]),
                "arrival": str(f[3]),
                "airline": f[4],
                "category": f[5]
            })

        # 3. Fetch 7-day historical data — only for the specific flights returned by SerpAPI
        live_iatas = [f["flight_iata"] for f in live_data_for_llm]
        cursor.execute("""
            SELECT flight_iata,
                   COUNT(*) as total_flights,
                   ROUND(AVG(departure_delay), 0) as avg_dep_delay,
                   ROUND(AVG(arrival_delay), 0) as avg_arr_delay,
                   SUM(CASE WHEN status = 'Canceled' THEN 1 ELSE 0 END) as cancel_count
            FROM flight_history
            WHERE flight_iata = ANY(%s)
              AND flight_date BETWEEN CURRENT_DATE - INTERVAL '8 days' AND CURRENT_DATE - INTERVAL '1 day'
            GROUP BY flight_iata;
        """, (live_iatas,))

        history_rows = cursor.fetchall()

        historical_data_for_llm = []
        for h in history_rows:
            historical_data_for_llm.append({
                "flight_iata": h[0],
                "total_flights_tracked": h[1],
                "avg_departure_variance_mins": float(h[2]) if h[2] is not None else 0,
                "avg_arrival_variance_mins": float(h[3]) if h[3] is not None else 0,
                "times_canceled": h[4]
            })

        # Historical window: CURRENT_DATE-8 to CURRENT_DATE-1 (matches SQL queries)
        today = datetime.now().date()
        history_start = (today - timedelta(days=8)).strftime("%-d %b %Y")
        history_end = (today - timedelta(days=1)).strftime("%-d %b %Y")

        # Pre-compute summary stats so the LLM doesn't have to aggregate
        total_tracked = len(historical_data_for_llm)  # unique flight IATAs with history
        on_time_count = sum(1 for h in historical_data_for_llm if h["avg_arrival_variance_mins"] <= 5)
        delayed_count = total_tracked - on_time_count
        avg_delay_all = (
            sum(h["avg_arrival_variance_mins"] for h in historical_data_for_llm) / total_tracked
            if total_tracked > 0 else 0
        )
        total_delay_impact_mins = sum(h["avg_arrival_variance_mins"] for h in historical_data_for_llm)
        tdh, tdm = divmod(int(abs(total_delay_impact_mins)), 60)
        total_delay_str = f"{tdh}h {tdm}m early" if total_delay_impact_mins < 0 else f"{tdh}h {tdm}m"

        user_prompt = f"""Route: {dep_iata} → {arrival_iata}
HISTORY_START: {history_start}
HISTORY_END: {history_end}

Pre-computed summary stats (use these exact numbers — do NOT recompute):
- Flights tracked historically: {total_tracked}
- On-time (avg arrival variance <= 5 min): {on_time_count}
- Delayed (avg arrival variance > 5 min): {delayed_count}
- Avg variance across tracked flights: {round(avg_delay_all)} mins
- Total schedule impact: {total_delay_str}

Live Flights Available:
{json.dumps(live_data_for_llm, indent=2)}

Historical Reliability Data (Last 7 Days):
{json.dumps(historical_data_for_llm, indent=2)}"""

        print(f"[LLM] Generating report via Groq ({GROQ_MODEL})...")

        response = client.chat.completions.create(
            model=GROQ_MODEL,
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt},
            ],
        )

        report_text = response.choices[0].message.content.strip()
        print("[SUCCESS] AI report generated.")

        return {"report": report_text}

    except Exception as e:
        print(f"[ERROR] {e}")
        raise e
    finally:
        if conn:
            cursor.close()
            conn.close()


import re as _re

_CITY_TO_IATA = {
    "delhi": "DEL", "new delhi": "DEL", "mumbai": "BOM", "bombay": "BOM",
    "bangalore": "BLR", "bengaluru": "BLR", "chennai": "MAA", "madras": "MAA",
    "kolkata": "CCU", "calcutta": "CCU", "hyderabad": "HYD", "goa": "GOI",
    "kochi": "COK", "cochin": "COK", "pune": "PNQ", "ahmedabad": "AMD",
    "jaipur": "JAI", "lucknow": "LKO", "chandigarh": "IXC", "nagpur": "NAG",
    "patna": "PAT", "bhubaneswar": "BBI", "visakhapatnam": "VTZ", "vizag": "VTZ",
    "srinagar": "SXR", "amritsar": "ATQ", "vadodara": "BDQ", "baroda": "BDQ",
    "indore": "IDR", "bhopal": "BHO", "coimbatore": "CJB", "trivandrum": "TRV",
    "thiruvananthapuram": "TRV", "mangalore": "IXE", "mangaluru": "IXE",
    "guwahati": "GAU", "varanasi": "VNS", "udaipur": "UDR", "jodhpur": "JDH",
    "leh": "IXL", "raipur": "RPR", "ranchi": "IXR", "dehradun": "DED",
    "jammu": "IXJ", "siliguri": "IXB", "bagdogra": "IXB",
    "dubai": "DXB", "london": "LHR", "heathrow": "LHR", "singapore": "SIN",
    "new york": "JFK", "nyc": "JFK", "paris": "CDG", "tokyo": "NRT",
    "sydney": "SYD", "bangkok": "BKK", "kuala lumpur": "KUL", "hong kong": "HKG",
    "toronto": "YYZ", "frankfurt": "FRA", "amsterdam": "AMS", "doha": "DOH",
    "abu dhabi": "AUH", "kathmandu": "KTM", "colombo": "CMB", "male": "MLE",
    "istanbul": "IST", "beijing": "PEK", "seoul": "ICN", "los angeles": "LAX",
    "chicago": "ORD", "san francisco": "SFO", "miami": "MIA", "muscat": "MCT",
    "riyadh": "RUH", "jeddah": "JED", "manila": "MNL", "jakarta": "CGK",
}

_IATA_TO_CITY = {v: k.title() for k, v in _CITY_TO_IATA.items()}


def _extract_iata_codes(text: str) -> list:
    """Extract IATA codes from city names or 3-letter codes mentioned in text."""
    found = set()
    text_lower = text.lower()
    # City names (longest match first to avoid partial hits)
    for city in sorted(_CITY_TO_IATA, key=len, reverse=True):
        if city in text_lower:
            found.add(_CITY_TO_IATA[city])
    # Bare 3-letter uppercase codes (e.g. DEL, BOM)
    for code in _re.findall(r'\b[A-Z]{3}\b', text):
        found.add(code)
    return list(found)


def _fetch_airport_context(cursor, iata: str) -> str:
    """Return a text block of DB stats for a given airport IATA code."""
    lines = [f"\n{_IATA_TO_CITY.get(iata, iata)} ({iata}) Airport Stats (last 7 days):"]

    # Departures
    cursor.execute("""
        SELECT COUNT(DISTINCT flight_iata),
               ROUND(AVG(departure_delay), 0),
               SUM(CASE WHEN departure_delay > 5 THEN 1 ELSE 0 END),
               COUNT(*),
               STRING_AGG(DISTINCT airline_name, ', ' ORDER BY airline_name)
        FROM flight_history
        WHERE origin = %s
          AND flight_date BETWEEN CURRENT_DATE - INTERVAL '8 days' AND CURRENT_DATE - INTERVAL '1 day'
          AND departure_delay IS NOT NULL;
    """, (iata,))
    row = cursor.fetchone()
    if row and row[3]:
        late_pct = round(float(row[2]) / row[3] * 100) if row[3] > 0 else 0
        avg_dep = float(row[1]) if row[1] else 0
        dep_str = f"{abs(int(avg_dep))} mins early" if avg_dep < 0 else f"{int(avg_dep)} mins"
        lines.append(f"  Departures: {row[0]} distinct flights, avg departure variance {dep_str}, {late_pct}% late")
        if row[4]:
            lines.append(f"  Airlines departing: {row[4]}")

    # Arrivals
    cursor.execute("""
        SELECT COUNT(DISTINCT flight_iata),
               ROUND(AVG(arrival_delay), 0),
               SUM(CASE WHEN arrival_delay > 5 THEN 1 ELSE 0 END),
               COUNT(*)
        FROM flight_history
        WHERE destination = %s
          AND flight_date BETWEEN CURRENT_DATE - INTERVAL '8 days' AND CURRENT_DATE - INTERVAL '1 day'
          AND arrival_delay IS NOT NULL;
    """, (iata,))
    row = cursor.fetchone()
    if row and row[3]:
        late_pct = round(float(row[2]) / row[3] * 100) if row[3] > 0 else 0
        avg_arr = float(row[1]) if row[1] else 0
        arr_str = f"{abs(int(avg_arr))} mins early" if avg_arr < 0 else f"{int(avg_arr)} mins"
        lines.append(f"  Arrivals: {row[0]} distinct flights, avg arrival variance {arr_str}, {late_pct}% late")

    return "\n".join(lines) if len(lines) > 1 else ""


def chat_with_context(report: dict, messages: list, search_id: int = None) -> str:
    """General-purpose flight assistant chat with full DB context."""
    context_parts = [f"Flight Analysis Report:\n{json.dumps(report, indent=2)}"]

    if search_id:
        conn = None
        try:
            conn = psycopg2.connect(**DB_CONFIG)
            cursor = conn.cursor()

            # Live flights for this search
            cursor.execute("""
                SELECT flight_number, price, departure_time, arrival_time,
                       airline_name, dep_iata, arrival_iata, category
                FROM live_flight_searches WHERE search_id = %s;
            """, (search_id,))
            live_rows = cursor.fetchall()

            if live_rows:
                dep_iata = live_rows[0][5]
                arr_iata = live_rows[0][6]
                live_list = [
                    {"flight": r[0], "price_inr": float(r[1]), "departure": str(r[2]),
                     "arrival": str(r[3]), "airline": r[4], "category": r[7]}
                    for r in live_rows
                ]

                # Per-flight historical stats for those live flights
                live_iatas = [r[0].replace(" ", "").upper() for r in live_rows]
                cursor.execute("""
                    SELECT flight_iata,
                           COUNT(*) as flights_tracked,
                           ROUND(AVG(departure_delay), 0) as avg_dep_variance,
                           ROUND(AVG(arrival_delay), 0) as avg_arr_variance,
                           SUM(CASE WHEN status = 'Canceled' THEN 1 ELSE 0 END) as cancellations
                    FROM flight_history
                    WHERE flight_iata = ANY(%s)
                      AND flight_date BETWEEN CURRENT_DATE - INTERVAL '8 days' AND CURRENT_DATE - INTERVAL '1 day'
                    GROUP BY flight_iata;
                """, (live_iatas,))
                hist_rows = cursor.fetchall()
                hist_list = [
                    {"flight": r[0], "flights_tracked": r[1],
                     "avg_departure_variance_mins": float(r[2]) if r[2] else 0,
                     "avg_arrival_variance_mins": float(r[3]) if r[3] else 0,
                     "cancellations": r[4]}
                    for r in hist_rows
                ]

                context_parts.append(f"\nRoute: {dep_iata} → {arr_iata}")
                context_parts.append(f"\nLive Flights Available:\n{json.dumps(live_list, indent=2)}")
                context_parts.append(f"\nPer-Flight Historical Stats (Last 7 Days):\n{json.dumps(hist_list, indent=2)}")
                # Always include origin + destination airport context
                for iata in {dep_iata, arr_iata}:
                    block = _fetch_airport_context(cursor, iata)
                    if block:
                        context_parts.append(block)

            # Also fetch context for any airport/city mentioned in the latest user message
            latest_user_msg = next(
                (m["content"] for m in reversed(messages) if m.get("role") == "user"), ""
            )
            mentioned = _extract_iata_codes(latest_user_msg)
            route_iatas = {live_rows[0][5], live_rows[0][6]} if live_rows else set()
            for iata in mentioned:
                if iata not in route_iatas:  # avoid duplicating route airports
                    block = _fetch_airport_context(cursor, iata)
                    if block:
                        context_parts.append(block)

        except Exception as e:
            print(f"[WARN] chat_with_context DB fetch failed: {e}")
        finally:
            if conn:
                cursor.close()
                conn.close()

    # Even without search_id, fetch context for airports mentioned in latest message
    if not search_id:
        latest_user_msg = next(
            (m["content"] for m in reversed(messages) if m.get("role") == "user"), ""
        )
        mentioned = _extract_iata_codes(latest_user_msg)
        if mentioned:
            conn = None
            try:
                conn = psycopg2.connect(**DB_CONFIG)
                cursor = conn.cursor()
                for iata in mentioned:
                    block = _fetch_airport_context(cursor, iata)
                    if block:
                        context_parts.append(block)
            except Exception as e:
                print(f"[WARN] chat_with_context airport lookup failed: {e}")
            finally:
                if conn:
                    cursor.close()
                    conn.close()

    full_context = "\n".join(context_parts)

    system_content = f"""You are Airrive AI, an expert flight assistant. You have access to the following live and historical flight data:

{full_context}

Answer any question the user asks — about this route, specific flights, airport performance, pricing, travel advice, or general aviation knowledge. Use the data above to give specific, accurate, data-backed answers whenever relevant. Maintain context from the full conversation history.
Never use the phrase "arrival delay". If a flight arrived before its scheduled time, say "arrived early" or "X mins early".
Never present any time value as a negative number. Early arrivals are always a positive number with the word "early"."""

    response = client.chat.completions.create(
        model=GROQ_MODEL,
        messages=[
            {"role": "system", "content": system_content},
            *messages,
        ],
    )

    return response.choices[0].message.content


def get_delay_report(search_id: int) -> dict:
    """Compute a structured delay pattern report with airport-level comparison."""
    conn = None
    try:
        conn = psycopg2.connect(**DB_CONFIG)
        cursor = conn.cursor()

        # Get the route from the live search cache
        cursor.execute("""
            SELECT dep_iata, arrival_iata FROM live_flight_searches
            WHERE search_id = %s LIMIT 1;
        """, (search_id,))
        row = cursor.fetchone()
        if not row:
            return {"error": "Search not found"}
        origin, dest = row

        def fmt_mins(m: float) -> str:
            early = m < 0
            m_abs = int(round(abs(m)))
            h, mm = divmod(m_abs, 60)
            time_str = f"{h}h {mm}m" if h else f"{mm}m"
            return f"{time_str} early" if early else time_str

        def parse_std_hour(std_str) -> int | None:
            if not std_str:
                return None
            for fmt in ("%I:%M %p", "%H:%M", "%I:%M%p"):
                try:
                    return datetime.strptime(std_str.strip(), fmt).hour
                except ValueError:
                    continue
            return None

        # ── Distinct flight stats for summary metrics ─────────────────────────
        cursor.execute("""
            SELECT flight_iata,
                   ROUND(AVG(arrival_delay), 0) as avg_arr_delay,
                   ROUND(AVG(departure_delay), 0) as avg_dep_delay
            FROM flight_history
            WHERE origin = %s AND destination = %s
              AND flight_date BETWEEN CURRENT_DATE - INTERVAL '8 days' AND CURRENT_DATE - INTERVAL '1 day'
            GROUP BY flight_iata;
        """, (origin, dest))
        distinct_rows = cursor.fetchall()

        if not distinct_rows:
            return {"report": f"No historical delay data available for {origin} → {dest} in the last 7 days."}

        total = len(distinct_rows)
        arr_delays = [float(r[1]) for r in distinct_rows if r[1] is not None]
        delayed_count = sum(1 for d in arr_delays if d > 5)
        avg_delay = sum(arr_delays) / len(arr_delays) if arr_delays else 0
        max_delay = max(arr_delays) if arr_delays else 0
        delayed_pct = round((delayed_count / total) * 100)

        # ── Raw rows for day-of-week and time-window analysis ─────────────────
        cursor.execute("""
            SELECT flight_date, std, arrival_delay
            FROM flight_history
            WHERE origin = %s AND destination = %s
              AND flight_date BETWEEN CURRENT_DATE - INTERVAL '8 days' AND CURRENT_DATE - INTERVAL '1 day'
              AND arrival_delay IS NOT NULL;
        """, (origin, dest))
        raw_rows = cursor.fetchall()

        # Worst day of week
        day_delays: dict = defaultdict(list)
        for r in raw_rows:
            if r[0] and r[2] is not None:
                day_delays[r[0].strftime("%A")].append(float(r[2]))
        worst_day = (
            max(day_delays, key=lambda d: sum(day_delays[d]) / len(day_delays[d]))
            if day_delays else "N/A"
        )

        # Worst time window
        TIME_WINDOWS = [
            ("6 AM – 11 AM",  6, 11),
            ("11 AM – 3 PM",  11, 15),
            ("3 PM – 7 PM",   15, 19),
            ("7 PM – 11 PM",  19, 23),
            ("11 PM – 6 AM",  23, 30),
        ]
        window_delays: dict = defaultdict(list)
        for r in raw_rows:
            hour = parse_std_hour(r[1])
            if hour is not None and r[2] is not None:
                for wname, start, end in TIME_WINDOWS:
                    in_window = (start <= hour < end) if end <= 24 else (hour >= start or hour < (end - 24))
                    if in_window:
                        window_delays[wname].append(float(r[2]))
                        break
        worst_window = (
            max(window_delays, key=lambda w: sum(window_delays[w]) / len(window_delays[w]))
            if window_delays else "N/A"
        )

        # ── Origin airport — distinct departing flights across all routes ──────
        cursor.execute("""
            SELECT COUNT(DISTINCT flight_iata),
                   ROUND(AVG(departure_delay), 0),
                   SUM(CASE WHEN departure_delay > 5 THEN 1 ELSE 0 END),
                   COUNT(*)
            FROM flight_history
            WHERE origin = %s
              AND flight_date BETWEEN CURRENT_DATE - INTERVAL '8 days' AND CURRENT_DATE - INTERVAL '1 day'
              AND departure_delay IS NOT NULL;
        """, (origin,))
        orig_row = cursor.fetchone()
        orig_avg_dep = float(orig_row[1]) if orig_row[1] is not None else 0
        orig_total_inst = orig_row[3] or 0
        orig_delayed_pct = round(float(orig_row[2]) / orig_total_inst * 100) if orig_total_inst > 0 else 0

        # ── Destination airport — distinct arriving flights across all routes ──
        cursor.execute("""
            SELECT COUNT(DISTINCT flight_iata),
                   ROUND(AVG(arrival_delay), 0),
                   SUM(CASE WHEN arrival_delay > 5 THEN 1 ELSE 0 END),
                   COUNT(*)
            FROM flight_history
            WHERE destination = %s
              AND flight_date BETWEEN CURRENT_DATE - INTERVAL '8 days' AND CURRENT_DATE - INTERVAL '1 day'
              AND arrival_delay IS NOT NULL;
        """, (dest,))
        dest_row = cursor.fetchone()
        dest_avg_arr = float(dest_row[1]) if dest_row[1] is not None else 0
        dest_total_inst = dest_row[3] or 0
        dest_delayed_pct = round(float(dest_row[2]) / dest_total_inst * 100) if dest_total_inst > 0 else 0

        # ── Pattern & recommendation ──────────────────────────────────────────
        pattern_line = f"Flights on {origin} → {dest} are more likely to be delayed"
        if worst_window != "N/A":
            pattern_line += f" during the {worst_window} window"
        if worst_day != "N/A":
            pattern_line += f", especially on {worst_day}s"
        pattern_line += "."

        rec_time = "before 3 PM" if worst_window in ("3 PM – 7 PM", "7 PM – 11 PM", "11 PM – 6 AM") else "in the morning"

        report = (
            f"**Delay Pattern Report**\n"
            f"Based on {total} distinct flights on this route (last 7 days):\n\n"
            f"Delayed flights: {delayed_pct}%\n"
            f"{_fmt_delay_field('Average delay', avg_delay)}\n"
            f"{_fmt_delay_field('Longest delay', max_delay)}\n"
            f"Most delay-prone time window: {worst_window}\n"
            f"Day with highest delays: {worst_day}\n\n"
            f"**{origin} Airport (all departing flights):**\n"
            f"{_fmt_delay_field('Avg departure delay', orig_avg_dep)}\n"
            f"Delay rate: {orig_delayed_pct}%\n\n"
            f"**{dest} Airport (all arriving flights):**\n"
            f"{_fmt_delay_field('Avg arrival time', dest_avg_arr)}\n"
            f"Delay rate: {dest_delayed_pct}%\n\n"
            f"**Pattern detected:**\n"
            f"{pattern_line}\n\n"
            f"**Recommendation:**\n"
            f"For business-critical travel, prefer departures {rec_time} on this route."
        )

        return {"report": report}

    except Exception as e:
        print(f"[ERROR] get_delay_report: {e}")
        raise e
    finally:
        if conn:
            cursor.close()
            conn.close()


def get_best_time_report(search_id: int) -> dict:
    """Compute on-time rate and avg delay per time window from historical data."""
    conn = None
    try:
        conn = psycopg2.connect(**DB_CONFIG)
        cursor = conn.cursor()

        # Get route
        cursor.execute("""
            SELECT dep_iata, arrival_iata FROM live_flight_searches
            WHERE search_id = %s LIMIT 1;
        """, (search_id,))
        row = cursor.fetchone()
        if not row:
            return {"error": "Search not found"}
        origin, dest = row

        # Fetch 7-day history
        cursor.execute("""
            SELECT std, arrival_delay
            FROM flight_history
            WHERE origin = %s AND destination = %s
              AND flight_date BETWEEN CURRENT_DATE - INTERVAL '8 days' AND CURRENT_DATE - INTERVAL '1 day'
              AND arrival_delay IS NOT NULL;
        """, (origin, dest))
        rows = cursor.fetchall()

        if not rows:
            return {"report": f"No historical data available for {origin} → {dest} in the last 7 days."}

        def parse_std_hour(std_str) -> int | None:
            if not std_str:
                return None
            for fmt in ("%I:%M %p", "%H:%M", "%I:%M%p"):
                try:
                    return datetime.strptime(std_str.strip(), fmt).hour
                except ValueError:
                    continue
            return None

        def fmt_mins(m: float) -> str:
            early = m < 0
            m_abs = int(round(abs(m)))
            h, mm = divmod(m_abs, 60)
            time_str = f"{h}h {mm}m" if h else f"{mm}m"
            return f"{time_str} early" if early else time_str

        # Three windows matching the report format
        WINDOWS = [
            ("Morning flights (6 AM – 11 AM)",    6,  11),
            ("Afternoon flights (12 PM – 5 PM)",  12,  17),
            ("Evening flights (6 PM – 11 PM)",    18,  23),
        ]

        window_delays: dict = defaultdict(list)
        for std_str, arr_delay in rows:
            hour = parse_std_hour(std_str)
            if hour is None:
                continue
            for wname, start, end in WINDOWS:
                if start <= hour <= end:
                    window_delays[wname].append(float(arr_delay))
                    break

        # Build per-window stats block
        blocks = []
        window_stats = []
        for wname, start, end in WINDOWS:
            delays = window_delays.get(wname, [])
            if not delays:
                blocks.append(f"{wname}\nNo data available")
                window_stats.append((wname, None, None))
                continue
            on_time_rate = round(sum(1 for d in delays if d <= 5) / len(delays) * 100)
            avg_d = sum(delays) / len(delays)
            blocks.append(
                f"{wname}\n"
                f"On-time rate: {on_time_rate}%\n"
                f"{_fmt_delay_field('Avg delay', avg_d)}"
            )
            window_stats.append((wname, on_time_rate, avg_d))

        # Insight: compare windows that have data
        valid = [(n, r, a) for n, r, a in window_stats if r is not None]
        if valid:
            best_w = max(valid, key=lambda x: x[1])
            worst_w = min(valid, key=lambda x: x[1])
            if best_w[0] != worst_w[0]:
                insight = (
                    f"Your {worst_w[0].split(' (')[0].lower()} flights are significantly "
                    f"more delay-prone than {best_w[0].split(' (')[0].lower()} departures."
                )
                rec = (
                    f"For routes you travel often, choose "
                    f"{best_w[0].split(' (')[0].lower()} sectors whenever possible."
                )
            else:
                insight = f"Delay patterns are fairly consistent across time windows on this route."
                rec = "Book whichever slot fits your schedule — delays are spread evenly."
        else:
            insight = "Not enough data to identify a clear pattern."
            rec = "Check back after more flights have been tracked on this route."

        report = (
            f"**Best Time to Fly Report**\n"
            f"Based on recent flight history ({origin} → {dest}):\n\n"
            + "\n\n".join(blocks)
            + f"\n\n**Insight:**\n{insight}\n\n**Recommendation:**\n{rec}"
        )

        return {"report": report}

    except Exception as e:
        print(f"[ERROR] get_best_time_report: {e}")
        raise e
    finally:
        if conn:
            cursor.close()
            conn.close()


AIRPORT_NAMES = {
    "DEL": "Delhi", "BOM": "Mumbai", "BLR": "Bengaluru", "MAA": "Chennai",
    "CCU": "Kolkata", "HYD": "Hyderabad", "GOI": "Goa", "COK": "Kochi",
    "AMD": "Ahmedabad", "PNQ": "Pune", "JAI": "Jaipur", "ATQ": "Amritsar",
    "IXC": "Chandigarh", "LKO": "Lucknow", "BHO": "Bhopal", "NAG": "Nagpur",
    "IXB": "Bagdogra", "GAU": "Guwahati", "IXR": "Ranchi", "PAT": "Patna",
    "DXB": "Dubai", "LHR": "London", "JFK": "New York", "SIN": "Singapore",
    "BKK": "Bangkok", "KUL": "Kuala Lumpur", "CDG": "Paris", "FRA": "Frankfurt",
    "AUH": "Abu Dhabi", "DOH": "Doha",
}


def get_airport_reliability_report() -> dict:
    """Show departure delay stats for all airports tracked in the last 24 hours."""
    conn = None
    try:
        conn = psycopg2.connect(**DB_CONFIG)
        cursor = conn.cursor()

        cursor.execute("""
            SELECT origin,
                   COUNT(DISTINCT flight_iata) as distinct_flights,
                   ROUND(AVG(departure_delay), 0) as avg_dep_delay
            FROM flight_history
            WHERE flight_date = CURRENT_DATE - INTERVAL '1 day'
              AND departure_delay IS NOT NULL
            GROUP BY origin
            ORDER BY AVG(departure_delay) DESC
            LIMIT 10;
        """)
        rows = cursor.fetchall()

        if not rows:
            return {"report": "No airport data available for the last 24 hours."}

        airport_blocks = []
        for iata, flights, avg_dep in rows:
            name = AIRPORT_NAMES.get(iata, iata)
            delay_val = float(avg_dep) if avg_dep is not None else 0
            airport_blocks.append(
                f"{name}\n"
                f"Flights: {flights}\n"
                f"{_fmt_delay_field('Avg departure delay', delay_val)}"
            )

        worst_iata, _, worst_dep = rows[0]
        worst_name = AIRPORT_NAMES.get(worst_iata, worst_iata)
        worst_val = float(worst_dep) if worst_dep is not None else 0

        if worst_val > 5:
            insight = f"{worst_name} showed the highest average departure delay in the last 24 hours."
            rec = f"For {worst_name} departures, consider arriving at the airport earlier and avoiding tight layovers."
        else:
            insight = "All tracked airports are performing well with minimal delays."
            rec = "Normal travel planning should suffice — no significant delay patterns detected."

        report = (
            f"**Airport Reliability Report**\n"
            f"Airports tracked in last 24 hours:\n\n"
            + "\n\n".join(airport_blocks)
            + f"\n\n**Insight:**\n{insight}\n\n**Recommendation:**\n{rec}"
        )

        return {"report": report}

    except Exception as e:
        print(f"[ERROR] get_airport_reliability_report: {e}")
        raise e
    finally:
        if conn:
            cursor.close()
            conn.close()
