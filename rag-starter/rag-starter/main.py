"""
RAG Assistant - CLI Interface
==============================
Interactive CLI for the RAG pipeline.
"""

import argparse
import sys
from src.pipeline import RAGPipeline


def interactive_mode(pipeline: RAGPipeline):
    """Run the RAG assistant in interactive mode."""
    print("=" * 50)
    print("RAG Assistant - Interactive Mode")
    print("=" * 50)
    print("Type 'quit' or 'exit' to stop\n")

    while True:
        try:
            query = input("You: ").strip()

            if query.lower() in ["quit", "exit", "q"]:
                print("Goodbye!")
                break

            if not query:
                continue

            response = pipeline.query(query, return_sources=True)

            print(f"\nAssistant: {response['answer']}")

            if "sources" in response and response["sources"]:
                print("\nSources:")
                for i, source in enumerate(response["sources"], 1):
                    print(f"  {i}. {source.get('metadata', {}).get('source', 'Unknown')}")
                    print(f"     {source['content'][:100]}...")

            print()

        except KeyboardInterrupt:
            print("\nGoodbye!")
            break
        except Exception as e:
            print(f"Error: {e}\n")


def demo_mode(pipeline: RAGPipeline):
    """Run with predefined demo questions."""
    demo_questions = [
        "What is the main topic of the documents?",
        "Summarize the key points.",
        "What are the main conclusions?"
    ]

    print("=" * 50)
    print("RAG Assistant - Demo Mode")
    print("=" * 50)

    for question in demo_questions:
        print(f"\nQ: {question}")
        response = pipeline.query(question)
        print(f"A: {response['answer']}")


def main():
    parser = argparse.ArgumentParser(description="RAG Assistant CLI")
    parser.add_argument(
        "--mode",
        choices=["interactive", "demo"],
        default="interactive",
        help="Mode to run the assistant"
    )
    parser.add_argument(
        "--data-dir",
        default="data/",
        help="Directory containing documents"
    )
    parser.add_argument(
        "--embedder",
        default="huggingface",
        choices=["huggingface", "openai", "ollama"],
        help="Embedder provider"
    )
    parser.add_argument(
        "--llm",
        default="ollama",
        choices=["ollama", "huggingface", "openai"],
        help="LLM provider"
    )
    parser.add_argument(
        "--llm-model",
        default="phi3",
        help="LLM model name"
    )
    parser.add_argument(
        "--k",
        type=int,
        default=4,
        help="Number of documents to retrieve"
    )
    parser.add_argument(
        "--chunk-size",
        type=int,
        default=500,
        help="Chunk size for text splitting"
    )

    args = parser.parse_args()

    print("Initializing RAG Pipeline...")
    print(f"  Data directory: {args.data_dir}")
    print(f"  Embedder: {args.embedder}")
    print(f"  LLM: {args.llm} ({args.llm_model})")
    print(f"  Retrieval K: {args.k}")
    print(f"  Chunk size: {args.chunk_size}")

    pipeline = RAGPipeline(
        data_dir=args.data_dir,
        embedder_provider=args.embedder,
        llm_provider=args.llm,
        llm_model=args.llm_model,
        retrieval_k=args.k,
        chunk_size=args.chunk_size
    )

    pipeline.load_and_index()

    if args.mode == "interactive":
        interactive_mode(pipeline)
    else:
        demo_mode(pipeline)


if __name__ == "__main__":
    main()
