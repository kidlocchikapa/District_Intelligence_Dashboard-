"""
LLM Generator Module
====================
Students: customize the prompt and LLM configuration.
"""

from typing import List, Optional, Dict
from langchain_community.llms import Ollama, HuggingFaceHub
from langchain_openai import ChatOpenAI
from langchain.chains import RetrievalQA
from langchain.prompts import PromptTemplate, ChatPromptTemplate
from langchain.schema import HumanMessage, SystemMessage


def get_llm(
    provider: str = "ollama",
    model_name: str = "phi3",
    temperature: float = 0.7,
    **kwargs
):
    """
    Get an LLM for generation.

    modify this:
    - Choose appropriate model (phi3, llama3, mistral, etc.)
    - Adjust temperature for creativity vs accuracy
    - Add API key configurations

    Recommended local models:
    - phi3 (small, fast)
    - llama3 (better quality)
    - mistral (balanced)
    """
    if provider == "ollama":
        return Ollama(model=model_name, temperature=temperature)
    elif provider == "huggingface":
        return HuggingFaceHub(
            repo_id=model_name,
            model_kwargs={"temperature": temperature}
        )
    elif provider == "openai":
        return ChatOpenAI(
            model=model_name,
            temperature=temperature,
            **kwargs
        )
    else:
        raise ValueError(f"Unknown provider: {provider}")


def create_rag_prompt(
    system_message: Optional[str] = None,
    template: Optional[str] = None
) -> PromptTemplate:
    """
    Create a RAG prompt template.

    modify:
    - Customize the system message for their scenario
    - Add citation/instruction formatting
    - Include few-shot examples
    """
    if system_message is None:
        system_message = """You are a helpful AI assistant.
Use the retrieved context to answer the user's question.
If you don't know the answer, say so clearly.
Always cite your sources when possible."""

    if template is None:
        template = """Context:
{context}

Question: {question}

Answer:"""

    prompt = PromptTemplate(
        template=template,
        input_variables=["context", "question"]
    )

    return prompt


def create_qa_chain(llm, retriever, prompt: Optional[PromptTemplate] = None):
    """
    Create a RetrievalQA chain.

    Students MUST modify:
    - Chain type (stuff, map_reduce, refine)
    - Add return_source_documents=True
    - Implement custom output parsing
    """
    if prompt is None:
        prompt = create_rag_prompt()

    qa_chain = RetrievalQA.from_chain_type(
        llm=llm,
        chain_type="stuff",
        retriever=retriever,
        prompt=prompt,
        return_source_documents=True
    )

    return qa_chain


def generate_response(
    qa_chain,
    query: str,
    return_sources: bool = True
) -> Dict:
    """
    Generate a response using the RAG pipeline.

    Returns:
        Dict with 'answer' and optionally 'source_documents'
    """
    result = qa_chain.invoke({"query": query})

    response = {
        "answer": result["result"]
    }

    if return_sources and "source_documents" in result:
        sources = [
            {
                "content": doc.page_content[:200] + "...",
                "metadata": doc.metadata
            }
            for doc in result["source_documents"]
        ]
        response["sources"] = sources

    return response


if __name__ == "__main__":
    # Test prompt creation
    prompt = create_rag_prompt()
    print("Default prompt template:")
    print(prompt.template)
