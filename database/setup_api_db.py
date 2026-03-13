import psycopg2
import os
from dotenv import load_dotenv

load_dotenv()
DB_CONFIG = {
    "dbname": os.getenv("DB_NAME"),
    "user": os.getenv("DB_USER"),
    "password": os.getenv("DB_PASSWORD"),
    "host": os.getenv("DB_HOST"),
    "port": os.getenv("DB_PORT")
}

def setup_api_tables():
    try:
        conn = psycopg2.connect(**DB_CONFIG)
        cursor = conn.cursor()
        
        current_dir = os.path.dirname(os.path.abspath(__file__))
        schema_path = os.path.join(current_dir, 'api_schema.sql')
        
        with open(schema_path, 'r') as file:
            sql_script = file.read()
            
        cursor.execute(sql_script)
        conn.commit()
        print("API tables (Audit Log & Live Searches) created successfully!")
        
    except Exception as e:
        print(f"Database error: {e}")
    finally:
        if 'cursor' in locals(): cursor.close()
        if 'conn' in locals(): conn.close()

if __name__ == "__main__":
    setup_api_tables()