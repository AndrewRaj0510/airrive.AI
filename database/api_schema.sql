-- 1. The Audit Log (Tracks every search event)
CREATE TABLE search_audit_logs (
    search_id SERIAL PRIMARY KEY,
    search_timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    origin VARCHAR(3) NOT NULL,
    destination VARCHAR(3) NOT NULL,
    flight_date DATE NOT NULL,
    trip_type VARCHAR(50)
);

-- 2. The Live Results Cache (Stores the flattened SerpApi data)
CREATE TABLE live_flight_searches (
    result_id SERIAL PRIMARY KEY,
    search_id INTEGER REFERENCES search_audit_logs(search_id) ON DELETE CASCADE,
    category VARCHAR(50),                  -- 'best_flights' or 'other_flights'
    dep_iata VARCHAR(10),
    arrival_iata VARCHAR(10),
    dep_airport_name VARCHAR(255),
    arr_airport_name VARCHAR(255),
    departure_time VARCHAR(50),
    arrival_time VARCHAR(50),
    price DECIMAL(10, 2),
    airline_name VARCHAR(255),             -- e.g., 'ANA, United'
    type_of_trip VARCHAR(50),
    duration_mins INTEGER,
    layover_dur_mins INTEGER,
    stops INTEGER,
    flight_number VARCHAR(50),             -- Primary flight (e.g., 'NH 962')
    connecting_flight_numbers TEXT,        -- Comma separated (e.g., 'NH 126, UA 2175')
    fetched_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);