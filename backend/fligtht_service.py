import os
import psycopg2
from serpapi import GoogleSearch
from dotenv import load_dotenv

load_dotenv()

DB_CONFIG = {
    "dbname": os.getenv("DB_NAME"),
    "user": os.getenv("DB_USER"),
    "password": os.getenv("DB_PASSWORD"),
    "host": os.getenv("DB_HOST"),
    "port": os.getenv("DB_PORT"),
    "sslmode": "require"
}

SERPAPI_KEY = os.getenv("SERPAPI_KEY")

def flatten_flight_data(flights_array, category_name):
    """Takes raw SerpApi JSON and squashes it down to our strict 14-column schema."""
    parsed_results = []
    for item in flights_array[:5]:
        legs = item.get("flights", [])
        if not legs:
            continue
            
        first_leg = legs[0]
        last_leg = legs[-1]
        
        airlines = list(set([leg.get("airline") for leg in legs if leg.get("airline")]))
        airline_name = ", ".join(airlines)
        
        first_flight_num = first_leg.get("flight_number", "Unknown")
        connecting_nums = ", ".join([leg.get("flight_number") for leg in legs[1:] if leg.get("flight_number")])
        
        layovers = item.get("layovers", [])
        layover_dur_mins = sum([lay.get("duration", 0) for lay in layovers])
        
        parsed = {
            "category": category_name,
            "dep_iata": first_leg.get("departure_airport", {}).get("id"),
            "arrival_iata": last_leg.get("arrival_airport", {}).get("id"),
            "dep_airport_name": first_leg.get("departure_airport", {}).get("name"),
            "arr_airport_name": last_leg.get("arrival_airport", {}).get("name"),
            "departure_time": first_leg.get("departure_airport", {}).get("time"),
            "arrival_time": last_leg.get("arrival_airport", {}).get("time"),
            "price": item.get("price", 0),
            "airline_name": airline_name,
            "type_of_trip": item.get("type", "One-way"),
            "duration_mins": item.get("total_duration", 0),
            "layover_dur_mins": layover_dur_mins,
            "stops": len(legs) - 1,
            "flight_number": first_flight_num,
            "connecting_flight_numbers": connecting_nums
        }
        parsed_results.append(parsed)
    return parsed_results

def _build_flight_list(rows):
    """Convert live_flight_searches rows into the same dict format as flatten_flight_data."""
    result = []
    for r in rows:
        result.append({
            "category": r[0],
            "dep_iata": r[1],
            "arrival_iata": r[2],
            "dep_airport_name": r[3],
            "arr_airport_name": r[4],
            "departure_time": r[5],
            "arrival_time": r[6],
            "price": float(r[7]),
            "airline_name": r[8],
            "type_of_trip": r[9],
            "duration_mins": r[10],
            "layover_dur_mins": r[11],
            "stops": r[12],
            "flight_number": r[13],
            "connecting_flight_numbers": r[14],
        })
    return result


def process_flight_search(origin: str, destination: str, outbound_date: str, return_date: str = None):
    """The main orchestration function for fetching, saving, and returning flights."""
    conn = None
    try:
        conn = psycopg2.connect(**DB_CONFIG)
        cursor = conn.cursor()

        # 1. Determine Trip Type and API 'type' parameter
        if return_date:
            trip_type = "Round trip"
            flight_type_param = "1"
        else:
            trip_type = "One-way"
            flight_type_param = "2"

        # --- CACHE CHECK: Same route + date already searched today? ---
        cursor.execute("""
            SELECT search_id FROM search_audit_logs
            WHERE origin = %s
              AND destination = %s
              AND flight_date = %s
              AND trip_type = %s
              AND search_timestamp::date = CURRENT_DATE
            ORDER BY search_timestamp DESC
            LIMIT 1;
        """, (origin, destination, outbound_date, trip_type))

        cached = cursor.fetchone()
        if cached:
            cached_search_id = cached[0]
            print(f"[CACHE HIT] Returning cached results for search_id={cached_search_id}")
            cursor.execute("""
                SELECT category, dep_iata, arrival_iata, dep_airport_name, arr_airport_name,
                       departure_time, arrival_time, price, airline_name, type_of_trip,
                       duration_mins, layover_dur_mins, stops, flight_number, connecting_flight_numbers
                FROM live_flight_searches
                WHERE search_id = %s
                ORDER BY price ASC;
            """, (cached_search_id,))
            all_rows = cursor.fetchall()
            best = sorted([r for r in _build_flight_list(all_rows) if r["category"] == "best_flights"], key=lambda x: x["price"])
            other = sorted([r for r in _build_flight_list(all_rows) if r["category"] == "other_flights"], key=lambda x: x["price"])
            return {"search_id": cached_search_id, "best_flights": best, "other_flights": other}
        # --- END CACHE CHECK ---

        # Log Search in Database
        cursor.execute("""
            INSERT INTO search_audit_logs (origin, destination, flight_date, trip_type)
            VALUES (%s, %s, %s, %s) RETURNING search_id;
        """, (origin, destination, outbound_date, trip_type))

        search_id = cursor.fetchone()[0]
        conn.commit()

        # 2. Fetch Live Data from SerpApi using the official client
        print(f"[FETCH] Querying SerpApi for {origin} -> {destination} on {outbound_date}...")
        params = {
            "engine": "google_flights",
            "departure_id": origin,
            "arrival_id": destination,
            "outbound_date": outbound_date,
            "type": flight_type_param,
            "currency": "INR",
            "api_key": SERPAPI_KEY
        }
        
        if return_date:
            params["return_date"] = return_date
            
        search = GoogleSearch(params)
        data = search.get_dict()
        
        if "error" in data:
            raise Exception(f"SerpApi Error: {data['error']}")
        
        # 3. Flatten the JSON 
        best_flights_parsed = flatten_flight_data(data.get("best_flights", []), "best_flights")
        other_flights_parsed = flatten_flight_data(data.get("other_flights", []), "other_flights")
        all_flights = best_flights_parsed + other_flights_parsed
        
        if not all_flights:
            print("[WARNING] No flights returned from SerpApi.")
            return {"search_id": search_id, "best_flights": [], "other_flights": []}

        # 4. Bulk Insert into Database
        print(f"[DB] Saving {len(all_flights)} flights to live_flight_searches...")
        insert_query = """
            INSERT INTO live_flight_searches 
            (search_id, category, dep_iata, arrival_iata, dep_airport_name, arr_airport_name, 
             departure_time, arrival_time, price, airline_name, type_of_trip, duration_mins, 
             layover_dur_mins, stops, flight_number, connecting_flight_numbers)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        """
        
        for f in all_flights:
            cursor.execute(insert_query, (
                search_id, f["category"], f["dep_iata"], f["arrival_iata"], f["dep_airport_name"], 
                f["arr_airport_name"], f["departure_time"], f["arrival_time"], f["price"], 
                f["airline_name"], f["type_of_trip"], f["duration_mins"], f["layover_dur_mins"], 
                f["stops"], f["flight_number"], f["connecting_flight_numbers"]
            ))
            
        conn.commit()
        print("[SUCCESS] Search and database insert completed cleanly.")

        add_to_tracker_query = """
            INSERT INTO flights (flight_iata, airline, origin, destination)
            VALUES (%s, %s, %s, %s)
            ON CONFLICT (flight_iata) DO NOTHING;
        """
        
        for f in all_flights:
            # Clean up the flight number (e.g., "6E 123" -> "6E123")
            clean_iata = f["flight_number"].replace(" ", "").upper()
            cursor.execute(add_to_tracker_query, (
                clean_iata, 
                f["airline_name"], 
                f["dep_iata"], 
                f["arrival_iata"]
            ))
        conn.commit()

        # 5. Scraper is now triggered (and awaited) in the analyze step to ensure
        #    fresh historical data before the AI report is generated.

        # 6. Return both lists sorted by price
        return {
            "search_id": search_id,
            "best_flights": sorted(best_flights_parsed, key=lambda x: x["price"]),
            "other_flights": sorted(other_flights_parsed, key=lambda x: x["price"])
        }

    except Exception as e:
        if conn: conn.rollback()
        raise e
    finally:
        if conn:
            cursor.close()
            conn.close()