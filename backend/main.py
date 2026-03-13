import os
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional
from fligtht_service import process_flight_search
from llm_service import analyze_flights, chat_with_context

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

@app.post("/api/chat")
def chat(request: ChatRequest):
    """Endpoint 3: Multi-turn chat grounded in a flight analysis report."""
    try:
        reply = chat_with_context(report=request.report, messages=request.messages)
        return {"reply": reply}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))