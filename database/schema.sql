-- 1. Create the 'flights' table (The Roster)
CREATE TABLE flights (
    flight_iata VARCHAR(10) PRIMARY KEY,
    airline VARCHAR(100) NOT NULL,
    origin VARCHAR(3) NOT NULL,
    destination VARCHAR(3) NOT NULL,
    last_scraped_at TIMESTAMP,            -- NULL = never scraped; set after each successful scrape

    CONSTRAINT chk_origin_length CHECK (char_length(origin) = 3),
    CONSTRAINT chk_dest_length CHECK (char_length(destination) = 3)
);

-- Migration (run once if the table already exists without this column):
-- ALTER TABLE flights ADD COLUMN IF NOT EXISTS last_scraped_at TIMESTAMP;

-- 2. Create the expanded 'flight_history' table
CREATE TABLE flight_history (
    id SERIAL PRIMARY KEY,            
    flight_iata VARCHAR(10) NOT NULL,     
    flight_date DATE NOT NULL,            
    
    -- FR24 specific data columns
    origin VARCHAR(3) NOT NULL,           -- Scraped FROM (useful in case of diversions)
    destination VARCHAR(3) NOT NULL,      -- Scraped TO
    aircraft VARCHAR(100),                -- e.g., 'A320-251N' or registration 'VT-EXO'
    flight_time VARCHAR(20),              -- e.g., '1h 45m'
    
    -- Timestamps (Storing as VARCHAR is safer for scraping raw text like '14:20' or '2:20 PM')
    std VARCHAR(10),                      -- Scheduled Time of Departure
    atd VARCHAR(10),                      -- Actual Time of Departure
    sta VARCHAR(10),                      -- Scheduled Time of Arrival
    ata VARCHAR(10),                      -- Actual Time of Arrival
    
    status VARCHAR(100) NOT NULL,         -- e.g., 'Landed 14:20', 'Canceled'
    
    -- Delay calculations (Integers representing minutes. Negative = Early)
    departure_delay INTEGER,              
    arrival_delay INTEGER,                
    
    CONSTRAINT fk_flight
        FOREIGN KEY (flight_iata) 
        REFERENCES flights(flight_iata)
        ON DELETE CASCADE,                
        
    -- CRITICAL: Prevent duplicate logs for the same flight on the same day
    CONSTRAINT unique_flight_log 
        UNIQUE (flight_iata, flight_date)
);