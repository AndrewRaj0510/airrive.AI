import subprocess
import sys
import os
from flask import Flask, jsonify

app = Flask(__name__)

SCRAPER_PATH = os.path.join(os.path.dirname(__file__), "scraper.py")
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

@app.route("/run-scraper", methods=["POST"])
def run_scraper():
    print("[API] Received request. Starting scraper...", flush=True)
    try:
        result = subprocess.run(
            [sys.executable, SCRAPER_PATH],
            cwd=PROJECT_ROOT
        )
        print(f"[API] Scraper finished with return code {result.returncode}", flush=True)
        return jsonify({
            "status": "success" if result.returncode == 0 else "error",
            "returncode": result.returncode
        }), 200
    except Exception as e:
        print(f"[API] Error: {e}", flush=True)
        return jsonify({"status": "error", "message": str(e)}), 500

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5001)
