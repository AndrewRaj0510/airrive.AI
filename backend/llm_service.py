import os
import json
import psycopg2
from groq import Groq
from dotenv import load_dotenv
from datetime import datetime
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
[Week Starting Date] – [Week Ending Date]

**Summary**
Flights available: [count of live flights]
Route: [ORIGIN] → [DESTINATION]
Airlines: [comma-separated unique airline names]
Flights tracked historically: [total historically tracked]
On-time: [on-time count] / [total historically tracked]
Delayed: [delayed count] / [total historically tracked]
Avg delay: [average arrival delay in minutes] mins
Total delay impact: [sum of all delays in Xh Ym format]

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
- Extract the travel date from the departure times in the live flight data
- A flight is on-time if avg_arrival_delay_mins <= 5; otherwise it is delayed
- If historical data is empty, set on-time/delayed to N/A and base observations on live pricing and timing only
- If a delay value is negative, write it as "X mins early" not "-X mins\""""


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
                "avg_departure_delay_mins": float(h[2]) if h[2] is not None else 0,
                "avg_arrival_delay_mins": float(h[3]) if h[3] is not None else 0,
                "times_canceled": h[4]
            })

        # Pre-compute summary stats so the LLM doesn't have to aggregate
        total_tracked = len(historical_data_for_llm)  # unique flight IATAs with history
        on_time_count = sum(1 for h in historical_data_for_llm if h["avg_arrival_delay_mins"] <= 5)
        delayed_count = total_tracked - on_time_count
        avg_delay_all = (
            sum(h["avg_arrival_delay_mins"] for h in historical_data_for_llm) / total_tracked
            if total_tracked > 0 else 0
        )
        total_delay_impact_mins = sum(h["avg_arrival_delay_mins"] for h in historical_data_for_llm)
        tdh, tdm = divmod(int(abs(total_delay_impact_mins)), 60)
        total_delay_str = f"{tdh}h {tdm}m early" if total_delay_impact_mins < 0 else f"{tdh}h {tdm}m"

        user_prompt = f"""Route: {dep_iata} → {arrival_iata}

Pre-computed summary stats (use these exact numbers — do NOT recompute):
- Flights tracked historically: {total_tracked}
- On-time (avg arrival delay <= 5 min): {on_time_count}
- Delayed (avg arrival delay > 5 min): {delayed_count}
- Avg delay across tracked flights: {round(avg_delay_all)} mins
- Total delay impact: {total_delay_str}

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


def chat_with_context(report: dict, messages: list) -> str:
    """Multi-turn chat grounded in the plain-text flight analysis report."""
    system_content = f"""You are an expert flight analyst assistant. The user received this flight analysis report:

{json.dumps(report, indent=2)}

Answer their follow-up questions concisely and specifically based only on the data in this report. Do not invent flights or data not present in the report."""

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
            f"{_fmt_delay_field('Avg arrival delay', dest_avg_arr)}\n"
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
