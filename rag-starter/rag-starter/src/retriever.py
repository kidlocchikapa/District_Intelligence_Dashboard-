"""
Retriever Module
================
Students must implement and customize retrieval strategies.
"""

from typing import List, Optional, Dict
from langchain_community.vectorstores import Chroma, FAISS
from langchain.schema import Document
from langchain.retrievers import ContextualCompressionRetriever
from langchain.retrievers.document_compressors import LLMChainExtractor
from langchain.retrievers.self_query.base import SelfQueryRetriever
from langchain.chains.query_constructor.base import AttributeInfo


def create_vectorstore(
    documents: List[Document],
    embedder,
    db_type: str = "chroma",
    persist_dir: Optional[str] = None
):
    """
    Create a vector store from documents.

    Students MUST modify:
    - Choose between ChromaDB, FAISS, or other vector DBs
    - Add metadata filtering fields
    """
    if db_type == "chroma":
        vectorstore = Chroma.from_documents(
            documents=documents,
            embedding=embedder,
            persist_directory=persist_dir
        )
    elif db_type == "faiss":
        vectorstore = FAISS.from_documents(
            documents=documents,
            embedding=embedder
        )
        if persist_dir:
            vectorstore.save_local(persist_dir)
    else:
        raise ValueError(f"Unknown DB type: {db_type}")

    return vectorstore


def get_retriever(
    vectorstore,
    search_type: str = "similarity",
    k: int = 4,
    score_threshold: Optional[float] = None,
    filter_criteria: Optional[Dict] = None
):
    """
    Create a retriever with customizable search parameters.

    Students MUST modify:
    - Adjust k (number of results)
    - Try different search types (similarity, mmr, similarity_threshold)
    - Add metadata filters
    - Implement hybrid search (BM25 + vector)
    """
    search_kwargs = {"k": k}

    if score_threshold is not None:
        search_kwargs["score_threshold"] = score_threshold

    if filter_criteria is not None:
        search_kwargs["filter"] = filter_criteria

    retriever = vectorstore.as_retriever(
        search_type=search_type,
        search_kwargs=search_kwargs
    )

    return retriever


def retrieve_with_hybrid_search(
    vectorstore,
    query: str,
    k: int = 4,
    alpha: float = 0.5
) -> List[Document]:
    """
    TODO: Implement hybrid search combining BM25 and vector similarity.

    Students should implement this for better recall.
    """
    raise NotImplementedError("Hybrid search not yet implemented")


def retrieve_with_reranking(
    retriever,
    query: str,
    k: int = 4
) -> List[Document]:
    """
    TODO: Implement reranking for improved relevance.

    Students can use LangChain's contextual compression or
    integrate a cross-encoder reranker.
    """
    raise NotImplementedError("Reranking not yet implemented")


if __name__ == "__main__":
    # Basic test
    from embedder import get_embedder
    from loader import load_documents, chunk_documents

    docs = load_documents()
    chunks = chunk_documents(docs)
    embedder = get_embedder()

    vectorstore = create_vectorstore(chunks, embedder)
    retriever = get_retriever(vectorstore, k=3)

    results = retriever.invoke("What is RAG?")
    print(f"Retrieved {len(results)} documents")
