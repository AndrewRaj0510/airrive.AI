import os
import re
import psycopg2
from datetime import datetime
from dotenv import load_dotenv
from playwright.sync_api import sync_playwright
from playwright_stealth import Stealth

# 1. Load Credentials
print("[SYSTEM] Loading environment variables...")
load_dotenv()
DB_CONFIG = {
    "dbname": os.getenv("DB_NAME"),
    "user": os.getenv("DB_USER"),
    "password": os.getenv("DB_PASSWORD"),
    "host": os.getenv("DB_HOST"),
    "port": os.getenv("DB_PORT")
}

def calculate_delay(scheduled, actual):
    if not scheduled or not actual or scheduled == "na" or actual == "na" or '—' in scheduled or '—' in actual:
        return None
    try:
        s_time = datetime.strptime(scheduled.strip(), "%I:%M %p")
        a_time = datetime.strptime(actual.strip(), "%I:%M %p")
        
        s_mins = (s_time.hour * 60) + s_time.minute
        a_mins = (a_time.hour * 60) + a_time.minute
        
        diff = a_mins - s_mins
        
        if diff < -1000:  
            diff += 1440
        elif diff > 1000:
            diff -= 1440
            
        return diff
    except ValueError:
        try:
            s_h, s_m = map(int, scheduled.strip().split(':'))
            a_h, a_m = map(int, actual.strip().split(':'))
            s_mins = (s_h * 60) + s_m
            a_mins = (a_h * 60) + a_m
            diff = a_mins - s_mins
            if diff < -1000: diff += 1440
            elif diff > 1000: diff -= 1440
            return diff
        except Exception:
            return None
    except Exception:
        return None

def run_scraper():
    print("[DB] Connecting to PostgreSQL...")
    try:
        conn = psycopg2.connect(**DB_CONFIG)
        cursor = conn.cursor()
        print("[DB] Connection successful.")
    except Exception as e:
        print(f"[DB ERROR] Could not connect to database: {e}")
        return
    
    # NEW: Fetch only flights that haven't been scraped today
    print("[DB] Fetching flights that need scraping...")
    cursor.execute("""
        SELECT flight_iata FROM flights 
        WHERE last_scraped_at IS NULL 
           OR DATE(last_scraped_at) < CURRENT_DATE;
    """)
    flights_to_track = [row[0] for row in cursor.fetchall()]
    
    if not flights_to_track:
        print("[DB SYSTEM] All flights are up to date! No scraping needed today. Exiting.")
        return
        
    print(f"[SYSTEM] Found {len(flights_to_track)} flight(s) to track today: {flights_to_track}")

    print("[BROWSER] Launching Playwright...")
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(
            viewport={'width': 1920, 'height': 1080},
            user_agent='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        )
        page = context.new_page()
        Stealth().apply_stealth_sync(page)
        print("[BROWSER] Stealth mode engaged. Ready to navigate.")

        for flight_iata in flights_to_track:
            print(f"\n{'='*50}")
            print(f"[SCRAPER] Target: {flight_iata}")
            url = f"https://www.flightradar24.com/data/flights/{flight_iata.lower()}"
            print(f"[SCRAPER] Navigating to URL: {url}")
            
            try:
                page.goto(url, wait_until="domcontentloaded")
                
                # Playwright automated cookie handling
                print("[BROWSER] Checking for cookie banner...")
                try:
                    accept_button = page.locator(
                        "button:has-text('Agree and close'), "
                        "button:has-text('Accept All'), "
                        "button:has-text('Continue')"
                    ).first
                    accept_button.click(timeout=5000)
                    print("[BROWSER] ✅ Cookie banner handled automatically.")
                except Exception:
                    print("[BROWSER] No cookie banner appeared.")

                print("[PAUSE] ⏳ Waiting 10 seconds for table to render (handle captchas manually if needed)...")
                page.wait_for_timeout(10000) 
                
                table_selector = "table tbody tr"
                try:
                    page.wait_for_selector(table_selector, timeout=10000)
                    print("[SCRAPER] Table found on page.")
                except Exception as e:
                    print(f"[ERROR] Could not find the table! Error: {e}")
                    continue

                rows = page.locator(table_selector).all()
                print(f"[SCRAPER] Found {len(rows)} total rows in the table. Analyzing...")
                
                for index, row in enumerate(rows):
                    cells = row.locator("td").all_inner_texts()
                    
                    if len(cells) < 11:
                        continue
                        
                    date_str = row.get_attribute("data-date")
                    if not date_str:
                        date_str = cells[2].strip() 
                    
                    origin_raw = cells[3].strip()
                    destination_raw = cells[4].strip()
                    
                    origin = re.search(r'\(([A-Z]{3})\)', origin_raw).group(1) if '(' in origin_raw else origin_raw[:3]
                    destination = re.search(r'\(([A-Z]{3})\)', destination_raw).group(1) if '(' in destination_raw else destination_raw[:3]
                    
                    aircraft = cells[5].strip()
                    flight_time = cells[6].strip()
                    std = cells[7].strip()
                    atd = cells[8].strip()
                    sta = cells[9].strip()
                    raw_status = cells[11].strip()
                    
                    std = "na" if not std or '—' in std else std
                    atd = "na" if not atd or '—' in atd else atd
                    sta = "na" if not sta or '—' in sta else sta
                    
                    if "Landed" in raw_status:
                        status = "Landed"
                        ata = raw_status.replace("Landed", "").strip()
                        ata = ata if ata else "na" 
                    elif "Canceled" in raw_status or "Cancelled" in raw_status:
                        status = "Canceled"
                        ata = "na"
                    else:
                        continue

                    dep_delay = calculate_delay(std, atd)
                    arr_delay = calculate_delay(sta, ata)

                    insert_query = """
                        INSERT INTO flight_history 
                        (flight_iata, flight_date, origin, destination, aircraft, flight_time, 
                         std, atd, sta, ata, status, departure_delay, arrival_delay)
                        VALUES (%s, %s::date, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                        ON CONFLICT (flight_iata, flight_date) 
                        DO UPDATE SET 
                            status = EXCLUDED.status,
                            atd = EXCLUDED.atd,
                            ata = EXCLUDED.ata,
                            departure_delay = EXCLUDED.departure_delay,
                            arrival_delay = EXCLUDED.arrival_delay;
                    """
                    
                    try:
                        cursor.execute(insert_query, (
                            flight_iata, date_str, origin, destination, aircraft, flight_time,
                            std, atd, sta, ata, status, dep_delay, arr_delay
                        ))
                        conn.commit()
                    except Exception as db_err:
                        print(f"  [DB ERROR] Failed to insert row for {date_str}: {db_err}")
                        conn.rollback()
                        
                # NEW: Update the timestamp in the flights table after successful scrape
                print(f"[DB] Marking {flight_iata} as successfully scraped today.")
                cursor.execute("""
                    UPDATE flights 
                    SET last_scraped_at = CURRENT_TIMESTAMP 
                    WHERE flight_iata = %s;
                """, (flight_iata,))
                conn.commit()

            except Exception as e:
                print(f"[FATAL ERROR] Failed to process flight {flight_iata}: {e}")
                
        print("\n[BROWSER] Closing browser...")
        browser.close()
    
    print("[DB] Closing connection...")
    cursor.close()
    conn.close()
    print("[SYSTEM] Scraping session complete!")

if __name__ == "__main__":
    run_scraper()