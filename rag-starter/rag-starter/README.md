# RAG Starter Template

A scaffolded RAG (Retrieval-Augmented Generation) implementation for students.

## Project Structure

```
rag-starter/
├── data/                 # Place your documents here
├── notebooks/            # For experimentation
├── src/
│   ├── loader.py        # Document loading & chunking
│   ├── embedder.py      # Text embedding
│   ├── retriever.py     # Similarity search
│   ├── generator.py     # LLM generation
│   └── pipeline.py      # Main orchestration
├── main.py              # CLI interface
├── requirements.txt
└── README.md
```

## Setup Instructions

### 1. Install Dependencies

```bash
pip install -r requirements.txt
```

### 2. Set Up Local LLM (Recommended)

Install Ollama for local LLM inference:

```bash
# macOS/Linux
curl -fsSL https://ollama.com/install.sh | sh

# Windows
# Download from https://ollama.com/download/windows
```

Pull a model:
```bash
ollama pull phi3
# or
ollama pull llama3
```

### 3. Add Your Documents

Place your documents in the `data/` directory:
- Text files: `.txt`
- PDFs: `.pdf` (requires pypdf - figure it out)
- And extend `loader.py` as needed

### 4. Run the Pipeline

```bash
# Interactive mode
python main.py --mode interactive

# Demo mode
python main.py --mode demo
```

## Required Modifications

**This is a scaffold - you MUST modify the following:**

| File | What to Modify |
|------|----------------|
| `src/loader.py` | Chunking strategy, file types |
| `src/embedder.py` | Embedding model selection |
| `src/retriever.py` | Retrieval parameters, hybrid search |
| `src/generator.py` | Prompt template, LLM choice |
| `src/pipeline.py` | Pipeline configuration, evaluation |

## Key Commands

```bash
# Run with custom settings
python main.py --llm-model llama3 --k 5 --chunk-size 300

# Run tests
python -m pytest
```

## Troubleshooting

- **No documents loaded**: Check `data/` directory contains valid files
- **LLM not responding**: Ensure Ollama is running (`ollama serve`)
- **Embedding errors**: Verify `sentence-transformers` installed correctly

## Resources

- LangChain RAG: https://github.com/langchain-ai/rag-from-scratch
- LlamaIndex: https://github.com/run-llama/llama_index
- Ollama: https://ollama.com

---