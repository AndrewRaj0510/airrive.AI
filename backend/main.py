import os
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional
from fligtht_service import process_flight_search
from llm_service import analyze_flights, chat_with_context, get_delay_report, get_best_time_report, get_airport_reliability_report

app = FastAPI(title="Flight AI Insights API")

_raw_origins = os.getenv("ALLOWED_ORIGINS", "http://localhost:3000")
allowed_origins = [o.strip() for o in _raw_origins.split(",")]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
# --- Pydantic Models ---
class SearchRequest(BaseModel):
    origin: str          
    destination: str     
    outbound_date: str            
    return_date: Optional[str] = None       

class AnalyzeRequest(BaseModel):
    search_id: int

class ChatRequest(BaseModel):
    report: dict
    messages: list
    search_id: Optional[int] = None

# --- Endpoints ---

@app.post("/api/search")
def search_flights(request: SearchRequest):
    """Endpoint 1: Fetches live prices and caches them."""
    try:
        result = process_flight_search(
            origin=request.origin,
            destination=request.destination,
            outbound_date=request.outbound_date,
            return_date=request.return_date
        )
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/analyze")
def generate_insights(request: AnalyzeRequest):
    """Endpoint 2: Generates LLM insights based on the cached search."""
    try:
        insights = analyze_flights(search_id=request.search_id)
        return insights
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/delay-report")
def delay_report(request: AnalyzeRequest):
    """Endpoint 4: Computes a delay pattern report from historical data."""
    try:
        result = get_delay_report(search_id=request.search_id)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/best-time-report")
def best_time_report(request: AnalyzeRequest):
    """Endpoint 5: Computes best time to fly from historical data."""
    try:
        result = get_best_time_report(search_id=request.search_id)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/airport-reliability")
def airport_reliability():
    """Endpoint 6: Airport reliability report from last 24 hours."""
    try:
        result = get_airport_reliability_report()
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/chat")
def chat(request: ChatRequest):
    """Endpoint 3: Multi-turn chat grounded in flight data and conversation history."""
    try:
        reply = chat_with_context(report=request.report, messages=request.messages, search_id=request.search_id)
        return {"reply": reply}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))