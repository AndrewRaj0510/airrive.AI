import os
import json
import psycopg2
from groq import Groq
from dotenv import load_dotenv

load_dotenv()

DB_CONFIG = {
    "dbname": os.getenv("DB_NAME"),
    "user": os.getenv("DB_USER"),
    "password": os.getenv("DB_PASSWORD"),
    "host": os.getenv("DB_HOST"),
    "port": os.getenv("DB_PORT")
}

GROQ_MODEL = os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile")
client = Groq(api_key=os.getenv("GROQ_API_KEY"))

SYSTEM_PROMPT = """You are an expert flight analyst writing a concise intelligence briefing for a traveller. You have live pricing data and seven days of historical reliability records for the route.

Follow this exact four-section structure. Each section heading must be on its own line wrapped in double asterisks (e.g. **Section Title**). Under each heading write 3 to 5 short, punchy lines — no tables, no JSON, no large paragraphs. Separate each section with a blank line. Use "•" for bullet points where appropriate.

Important: whenever you mention a flight number, always pair it with the airline name (e.g. "IndiGo 6E456" not just "6E456").

**Reliability & Delay Trends**
• Identify specific flight IATAs and airlines that are consistently on time or delayed using the historical data.
• State average delay figures where relevant. A negative value means the flight typically arrives early.
• Highlight the most reliable time of day to fly on this route.

**Pricing Forecast & Booking Window**
• Analyse current prices. Name the cheapest and most expensive options explicitly.
• Predict whether prices are likely to rise or fall based on standard airline yield management for this route.
• State the best day of the week and booking window to secure the best fare.

**Real-World Impact & Disruptions**
• Detail any seasonal patterns, weather risks, public holidays, major events, or airport congestion factors currently affecting this route.
• Keep it specific to the origin and destination airports.

**The Smart Booking Verdict**
• List the top 2–3 recommended flights with flight number and departure → arrival time.
• Give a single, definitive recommendation on exactly what to book and why — no hedging.

Output only the four sections above. Do not add any introduction, conclusion, or extra commentary outside these sections."""


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

        # 3. Fetch 7-day historical data for this route (origin → destination)
        cursor.execute("""
            SELECT flight_iata,
                   COUNT(*) as total_flights,
                   ROUND(AVG(departure_delay), 0) as avg_dep_delay,
                   ROUND(AVG(arrival_delay), 0) as avg_arr_delay,
                   SUM(CASE WHEN status = 'Canceled' THEN 1 ELSE 0 END) as cancel_count
            FROM flight_history
            WHERE origin = %s AND destination = %s
              AND flight_date BETWEEN CURRENT_DATE - INTERVAL '8 days' AND CURRENT_DATE - INTERVAL '1 day'
            GROUP BY flight_iata;
        """, (dep_iata, arrival_iata))

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

        user_prompt = f"""Route: {dep_iata} → {arrival_iata}

Live Flights Available:
{json.dumps(live_data_for_llm, indent=2)}

Historical Reliability Data (Last 7 Days on this route):
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
