from functools import lru_cache
from pathlib import Path
from pydantic import BaseModel
import os
from dotenv import load_dotenv

load_dotenv()

ROOT = Path(__file__).resolve().parent.parent

class Settings(BaseModel):
    # LLM (OpenAI-compatible / NVIDIA NIM / OpenAI)
    llm_api_key: str = os.getenv("NVIDIA_API_KEY") or os.getenv("OPENAI_API_KEY", "")
    llm_base_url: str = os.getenv("LLM_BASE_URL", "https://integrate.api.nvidia.com/v1")
    llm_model: str = os.getenv("LLM_MODEL", "meta/llama-3.3-70b-instruct")

    # Embeddings (BGE-M3 default dimension is 1024)
    # Options for embedding_provider: "huggingface" (local BGE-M3) or "nvidia" (OpenAI-compatible endpoint)
    embedding_provider: str = os.getenv("EMBEDDING_PROVIDER", "huggingface")
    embedding_model: str = os.getenv("EMBEDDING_MODEL", "BAAI/bge-m3")
    embedding_dimension: int = int(os.getenv("EMBEDDING_DIMENSION", "1024"))
    embedding_api_key: str = os.getenv("EMBEDDING_API_KEY") or os.getenv("NVIDIA_API_KEY") or os.getenv("OPENAI_API_KEY", "")
    embedding_base_url: str = os.getenv("EMBEDDING_BASE_URL", "https://integrate.api.nvidia.com/v1")

    pinecone_api_key: str = os.getenv("PINECONE_API_KEY", "")
    pinecone_index_name: str = os.getenv("PINECONE_INDEX_NAME", "cloudops-sentinel-bge-m3")
    pinecone_namespace: str = os.getenv("PINECONE_NAMESPACE", "incident-runbooks")
    pinecone_cloud: str = os.getenv("PINECONE_CLOUD", "aws")
    pinecone_region: str = os.getenv("PINECONE_REGION", "us-east-1")

    # Internet search
    tavily_api_key: str = os.getenv("TAVILY_API_KEY", "")

    # Self-RAG controls
    top_k: int = int(os.getenv("TOP_K", "5"))
    max_support_retries: int = int(os.getenv("MAX_SUPPORT_RETRIES", "2"))
    max_retrieval_rewrites: int = int(os.getenv("MAX_RETRIEVAL_REWRITES", "2"))
    max_web_rewrites: int = int(os.getenv("MAX_WEB_REWRITES", "2"))
    database_path: str = os.getenv("DATABASE_PATH", "data/audit.db")

    @property
    def database_file(self) -> Path:
        p = Path(self.database_path)
        return p if p.is_absolute() else ROOT / p



@lru_cache
def get_settings() -> Settings:
    return Settings()