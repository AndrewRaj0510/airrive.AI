import psycopg2
from psycopg2 import Error
import os
from dotenv import load_dotenv

# 1. Load the environment variables from the .env file
# This looks for a .env file in the same directory or parent directories
load_dotenv()

# 2. Pull the credentials securely
DB_CONFIG = {
    "dbname": os.getenv("DB_NAME"),
    "user": os.getenv("DB_USER"),
    "password": os.getenv("DB_PASSWORD"),
    "host": os.getenv("DB_HOST"),
    "port": os.getenv("DB_PORT")
}

def create_database_schema():
    # Basic validation to ensure the .env file was read correctly
    if not DB_CONFIG["password"]:
        print("Error: DB_PASSWORD not found. Please check your .env file.")
        return

    connection = None
    try:
        print("Connecting to the PostgreSQL database...")
        connection = psycopg2.connect(**DB_CONFIG)
        cursor = connection.cursor()

        current_dir = os.path.dirname(os.path.abspath(__file__))
        schema_path = os.path.join(current_dir, 'schema.sql')

        print(f"Reading SQL file from: {schema_path}")
        with open(schema_path, 'r') as file:
            sql_script = file.read()

        print("Executing schema setup...")
        cursor.execute(sql_script)

        connection.commit()
        print("Empty database tables and constraints created successfully!")

    except (Exception, Error) as error:
        print(f"Error while connecting to PostgreSQL or executing script:\n{error}")

    finally:
        if connection:
            cursor.close()
            connection.close()
            print("PostgreSQL connection is closed.")

if __name__ == "__main__":
    create_database_schema()