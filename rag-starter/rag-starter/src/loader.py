"""
Document Loader and Chunker
===========================
"""

from pathlib import Path
from typing import List, Optional
from langchain_community.document_loaders import (
    TextLoader,
    PyPDFLoader,
    WebBaseLoader,
    DirectoryLoader
)
from langchain.text_splitter import (
    RecursiveCharacterTextSplitter,
    MarkdownHeaderTextSplitter,
    TokenTextSplitter
)


def load_documents(data_dir: str = "data/") -> List:
    """
    Load documents from the data directory.
    TODO: Extend to support more file types (PDF, HTML, etc.)
    """
    path = Path(data_dir)
    documents = []

    # Basic text file loading - extend this for your scenario
    for file_path in path.glob("*.txt"):
        loader = TextLoader(str(file_path), encoding="utf-8")
        documents.extend(loader.load())

    # TODO: Add PDF loader
    # for pdf_path in path.glob("*.pdf"):
    #     loader = PyPDFLoader(str(pdf_path))
    #     documents.extend(loader.load())

    return documents


def chunk_documents(
    documents: List,
    chunk_size: int = 500,
    chunk_overlap: int = 50,
    chunking_strategy: str = "recursive"
) -> List:
    """
    Split documents into chunks.

    Students MUST modify this function:
    - Experiment with different chunk sizes
    - Try different text splitters (Markdown, Token-based)
    - Add metadata to chunks (source, page number, etc.)
    """
    if chunking_strategy == "recursive":
        splitter = RecursiveCharacterTextSplitter(
            chunk_size=chunk_size,
            chunk_overlap=chunk_overlap,
            separators=["\n\n", "\n", " ", ""]
        )
    elif chunking_strategy == "markdown":
        headers_to_split_on = [
            ("#", "Header 1"),
            ("##", "Header 2"),
            ("##", "Header 3"),
        ]
        splitter = MarkdownHeaderTextSplitter(headers_to_split_on)
    elif chunking_strategy == "token":
        splitter = TokenTextSplitter(
            chunk_size=chunk_size,
            chunk_overlap=chunk_overlap
        )
    else:
        raise ValueError(f"Unknown chunking strategy: {chunking_strategy}")

    chunks = splitter.split_documents(documents)

    # TODO: Add custom chunk metadata
    # for i, chunk in enumerate(chunks):
    #     chunk.metadata["chunk_id"] = i

    return chunks


if __name__ == "__main__":
    docs = load_documents()
    chunks = chunk_documents(docs)
    print(f"Loaded {len(docs)} documents, created {len(chunks)} chunks")
