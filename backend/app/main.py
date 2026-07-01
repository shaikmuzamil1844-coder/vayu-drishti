from dotenv import load_dotenv
load_dotenv()  # Load .env before anything else

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.routers import data, predict, simulate, chat

app = FastAPI(
    title="VAYU-DRISHTI API",
    description="AI-Powered Digital Twin Engine for India's Climate",
    version="1.0.0"
)

# Configure CORS for Next.js dev server
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # For hackathon, allow all. In production, specify front-end domain.
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register routes
app.include_router(data.router, prefix="/api", tags=["Climate Data"])
app.include_router(predict.router, prefix="/api", tags=["Climate Predictions"])
app.include_router(simulate.router, prefix="/api", tags=["Climate Simulations"])
app.include_router(chat.router, prefix="/api", tags=["Climate AI Copilot"])

@app.get("/")
def read_root():
    return {
        "status": "online",
        "service": "VAYU-DRISHTI Climate Digital Twin Backend",
        "endpoints": [
            "/api/data",
            "/api/predict",
            "/api/simulate",
            "/api/chat"
        ]
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
