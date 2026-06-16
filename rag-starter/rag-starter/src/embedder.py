"""
Embedding Model
===============
Students must choose and configure the embedding model.
"""

from typing import List, Optional
from langchain_community.embeddings import HuggingFaceEmbeddings, OllamaEmbeddings
from langchain_openai import OpenAIEmbeddings


def get_embedder(
    provider: str = "huggingface",
    model_name: str = "sentence-transformers/all-MiniLM-L6-v2",
    **kwargs
):
    """
    Get an embedding model.

    Students: Modify this:
    - Try different embedding models (e.g., BAAI/bge-small-en)
    - Test Ollama embeddings for local inference

    Args:
        provider: "huggingface", "openai", or "ollama"
        model_name: Name of the embedding model
    """
    if provider == "huggingface":
        # Open-source, free to use
        return HuggingFaceEmbeddings(
            model_name=model_name,
            model_kwargs={"device": "cpu"}
        )
    elif provider == "openai":
        # Requires OPENAI_API_KEY
        # Explore the following link for free usable api keys:
        # https://console.groq.com/keys
        return OpenAIEmbeddings(model=model_name)
    elif provider == "ollama":
        # Local inference via Ollama
        return OllamaEmbeddings(model=model_name)
    else:
        raise ValueError(f"Unknown provider: {provider}")


def embed_documents(embedder, documents: List) -> List[List[float]]:
    """
    Embed a list of documents.

    TODO: Add batch processing for large document sets
    """
    texts = [doc.page_content for doc in documents]
    embeddings = embedder.embed_documents(texts)
    return embeddings


def embed_query(embedder, query: str) -> List[float]:
    """
    Embed a query string.
    """
    return embedder.embed_query(query)


if __name__ == "__main__":
    embedder = get_embedder()
    test_text = "What is Retrieval-Augmented Generation?"
    embedding = embed_query(embedder, test_text)
    print(f"Embedding dimension: {len(embedding)}")
