from typing import List, TypedDict, Literal, Annotated
import operator
import sqlite3
from pathlib import Path
from pydantic import BaseModel, Field
from langchain_core.documents import Document
from langchain_core.prompts import ChatPromptTemplate
from langchain_openai import ChatOpenAI
from langgraph.graph import StateGraph, START, END
from langgraph.checkpoint.sqlite import SqliteSaver
from tavily import TavilyClient
from src.config import get_settings
from src.vectorstore import get_retriever


class RAGState(TypedDict, total=False):
    user_question: str
    question: str
    memory: Annotated[List[str], operator.add]
    retrieval_query: str
    web_query: str
    need_retrieval: bool
    docs: List[Document]
    relevant_docs: List[Document]
    context: str
    answer: str
    support_status: Literal["fully_supported", "partially_supported", "no_support", ""]
    evidence: List[str]
    usefulness: Literal["useful", "not_useful", ""]
    use_reason: str
    support_retries: int
    retrieval_rewrites: int
    web_rewrites: int
    source_mode: Literal["internal", "web", "direct", "none"]
    used_web_search: bool
    trace: List[str]


class RetrieveDecision(BaseModel):
    should_retrieve: bool


class RelevanceDecision(BaseModel):
    is_relevant: bool


class SupportDecision(BaseModel):
    status: Literal["fully_supported", "partially_supported", "no_support"]
    evidence: List[str] = Field(default_factory=list)


class UsefulnessDecision(BaseModel):
    status: Literal["useful", "not_useful"]
    reason: str


class QueryRewrite(BaseModel):
    query: str


def _llm():
    s = get_settings()
    if not s.openai_api_key:
        raise RuntimeError("OPENAI_API_KEY is not configured")
    return ChatOpenAI(
        api_key=s.openai_api_key,
        model=s.openai_model,
        temperature=0,
    )


def _trace(state: RAGState, item: str):
    return [*(state.get("trace") or []), item]



def _format_context(docs: List[Document]) -> str:
    blocks = []
    for i, d in enumerate(docs,1):
        meta = d.metadata or {}
        if meta.get("source_type") == "web":
            head = f"[WEB {i}] {meta.get('title','')} | {meta.get('url','')}"
        else:
            head = f"[INTERNAL {i}] {meta.get('title') or meta.get('document_name') or meta.get('source','')}"
            if meta.get("page") is not None:
                head += f" | page {int(meta['page']) + 1}"

        blocks.append(f"{head}\n{d.page_content}")

    return "\n\n---\n\n".join(blocks)



