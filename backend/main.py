from fastapi import FastAPI

app = FastAPI(title="WhatsApp Orchestrator Backend")

@app.get("/health")
async def health_check():
    return {"status": "ok"}