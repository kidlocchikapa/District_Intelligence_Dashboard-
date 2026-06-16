"""
RAG Pipeline Orchestration
===========================
Main pipeline that ties together all RAG components.
"""

import logging
from typing import List, Optional, Dict
from pathlib import Path

from loader import load_documents, chunk_documents
from embedder import get_embedder
from retriever import create_vectorstore, get_retriever
from generator import get_llm, create_rag_prompt, create_qa_chain, generate_response


logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class RAGPipeline:
    """
    Main RAG Pipeline class.

    Students MUST modify this class:
    - Add initialization options
    - Implement caching
    - Add evaluation hooks
    - Customize preprocessing/postprocessing
    """

    def __init__(
        self,
        data_dir: str = "data/",
        embedder_provider: str = "huggingface",
        embedder_model: str = "sentence-transformers/all-MiniLM-L6-v2",
        llm_provider: str = "ollama",
        llm_model: str = "phi3",
        chunk_size: int = 500,
        chunk_overlap: int = 50,
        retrieval_k: int = 4,
        vectorstore_type: str = "chroma",
        persist_dir: Optional[str] = "vectorstore"
    ):
        self.data_dir = data_dir
        self.chunk_size = chunk_size
        self.chunk_overlap = chunk_overlap
        self.retrieval_k = retrieval_k
        self.persist_dir = persist_dir

        # Initialize components - students can modify configurations
        logger.info("Initializing embedder...")
        self.embedder = get_embedder(
            provider=embedder_provider,
            model_name=embedder_model
        )

        logger.info("Initializing LLM...")
        self.llm = get_llm(
            provider=llm_provider,
            model_name=llm_model
        )

        self.vectorstore = None
        self.retriever = None
        self.qa_chain = None

    def load_and_index(self, force_rebuild: bool = False):
        """
        Load documents and create vector index.

        Students MUST modify:
        - Add incremental indexing
        - Implement document update logic
        """
        # Check if vectorstore exists
        persist_path = Path(self.persist_dir) if self.persist_dir else None
        if persist_path and persist_path.exists() and not force_rebuild:
            logger.info("Loading existing vectorstore...")
            # TODO: Load from persist_dir
            # self.vectorstore = Chroma(persist_directory=self.persist_dir, ...)
        else:
            logger.info("Loading and chunking documents...")
            documents = load_documents(self.data_dir)
            chunks = chunk_documents(
                documents,
                chunk_size=self.chunk_size,
                chunk_overlap=self.chunk_overlap
            )
            logger.info(f"Created {len(chunks)} chunks from {len(documents)} documents")

            logger.info("Creating vector index...")
            self.vectorstore = create_vectorstore(
                chunks,
                self.embedder,
                db_type="chroma",
                persist_dir=self.persist_dir
            )

        logger.info("Setting up retriever...")
        self.retriever = get_retriever(
            self.vectorstore,
            k=self.retrieval_k
        )

        logger.info("Creating QA chain...")
        prompt = create_rag_prompt()
        self.qa_chain = create_qa_chain(self.llm, self.retriever, prompt)

    def query(self, question: str, return_sources: bool = True) -> Dict:
        """
        Query the RAG pipeline.

        Students MUST modify:
        - Add query preprocessing
        - Implement response postprocessing
        - Add confidence scoring
        - Implement fallback logic
        """
        if self.qa_chain is None:
            raise RuntimeError("Pipeline not initialized. Call load_and_index() first.")

        logger.info(f"Querying: {question}")
        response = generate_response(self.qa_chain, question, return_sources)
        return response

    def evaluate(self, test_queries: List[Dict]) -> Dict:
        """
        Evaluate the pipeline on test queries.

        Students MUST implement this:
        - Calculate precision/recall
        - Measure hallucination rates
        - Add human evaluation metrics
        """
        results = []
        for item in test_queries:
            query = item["question"]
            expected = item.get("expected_answer", "")

            response = self.query(query, return_sources=True)
            results.append({
                "query": query,
                "expected": expected,
                "answer": response["answer"],
                "sources": response.get("sources", [])
            })

        # TODO: Implement evaluation metrics
        # - Precision@K
        # - Context relevance
        # - Answer quality

        return {"results": results}


def main():
    """Main entry point for testing."""
    pipeline = RAGPipeline(
        data_dir="data/",
        embedder_provider="huggingface",
        llm_provider="ollama",
        llm_model="phi3",
        retrieval_k=3
    )

    pipeline.load_and_index()

    # Example query
    response = pipeline.query("What is Retrieval-Augmented Generation?")
    print("\nAnswer:", response["answer"])
    if "sources" in response:
        print("\nSources:", response["sources"])


if __name__ == "__main__":
    main()
