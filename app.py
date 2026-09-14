from pathlib import Path
import shutil
import uuid
from typing import List

from fastapi import FastAPI, File, UploadFile, HTTPException, Request
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

from src.config import get_settings
from src.models import ChatRequest, ChatResponse, UploadResponse
from src.self_rag import run_self_rag
from src.ingestion import ingest_file, SUPPORTED
from src.db import init_db, save_audit, latest_audits
from src.vectorstore import ensure_index

app = FastAPI(
    title="CloudOps Sentinel Copilot",
    description="Industry-Grade Self-RAG Cloud Operations AI Copilot",
    version="1.0.0"
)

BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"
TEMPLATES_DIR = BASE_DIR / "templates"
UPLOADS_DIR = BASE_DIR / "uploads"
UPLOADS_DIR.mkdir(parents=True, exist_ok=True)

app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")
templates = Jinja2Templates(directory=str(TEMPLATES_DIR))


@app.on_event("startup")
def on_startup():
    init_db()


@app.get("/", response_class=HTMLResponse)
def index(request: Request):
    settings = get_settings()
    return templates.TemplateResponse(
        request=request,
        name="index.html",
        context={
            "llm_model": settings.llm_model,
            "embedding_model": settings.embedding_model,
            "embedding_dimension": settings.embedding_dimension,
            "pinecone_index": settings.pinecone_index_name,
            "pinecone_namespace": settings.pinecone_namespace,
        },
    )


@app.get("/api/config")
def get_system_config():
    s = get_settings()
    return {
        "llm_model": s.llm_model,
        "llm_base_url": s.llm_base_url,
        "embedding_provider": s.embedding_provider,
        "embedding_model": s.embedding_model,
        "embedding_dimension": s.embedding_dimension,
        "pinecone_index": s.pinecone_index_name,
        "pinecone_namespace": s.pinecone_namespace,
        "top_k": s.top_k,
    }


@app.post("/api/chat", response_model=ChatResponse)
def chat_endpoint(req: ChatRequest):
    try:
        result = run_self_rag(question=req.question, thread_id=req.thread_id)
        save_audit(question=req.question, result=result)
        return ChatResponse(**result)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/upload", response_model=UploadResponse)
async def upload_document(file: UploadFile = File(...)):
    suffix = Path(file.filename).suffix.lower()
    if suffix not in SUPPORTED:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file format '{suffix}'. Supported: {', '.join(SUPPORTED)}"
        )

    saved_path = UPLOADS_DIR / f"{uuid.uuid4().hex[:8]}_{file.filename}"
    try:
        with open(saved_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)

        # Ensure Pinecone index exists with correct dimensions before inserting
        ensure_index()
        chunks = ingest_file(saved_path)

        return UploadResponse(
            filename=file.filename,
            chunks_indexed=chunks,
            namespace=get_settings().pinecone_namespace
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Ingestion error: {str(e)}")
    finally:
        file.file.close()


@app.get("/api/audit")
def get_audit_trail(limit: int = 25):
    try:
        audits = latest_audits(limit=limit)
        return audits
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/health")
def health():
    return {"status": "healthy", "service": "CloudOps Sentinel Copilot"}
