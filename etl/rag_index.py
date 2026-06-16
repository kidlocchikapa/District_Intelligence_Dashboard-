import hashlib
import json
import os
import re
from pathlib import Path

import pandas as pd
from sqlalchemy import text

from db_utils import table_exists

DEFAULT_EMBEDDING_DIMENSIONS = 1536
SUPPORTED_EXTENSIONS = {".txt", ".md", ".markdown", ".json", ".csv", ".html", ".htm"}


def normalize_text(value):
    return re.sub(r"\s+", " ", str(value or "")).strip()


def normalize_key(value):
    return normalize_text(value).lower()


def truthy_text(value):
    normalized = normalize_key(value)
    return bool(
        normalized and normalized not in {"all", "national", "malawi", "overview", "general"}
    )


def parse_front_matter_value(value):
    trimmed = normalize_text(value)
    if not trimmed:
        return ""

    if (trimmed.startswith("[") and trimmed.endswith("]")) or (
        trimmed.startswith("{") and trimmed.endswith("}")
    ):
        try:
            return json.loads(trimmed)
        except Exception:
            return trimmed

    if "," in trimmed:
        return [normalize_text(item) for item in trimmed.split(",") if normalize_text(item)]

    return trimmed.strip("'\"")


def parse_front_matter(text_value):
    source = str(text_value or "")
    if not source.lstrip().startswith("---"):
        return {"metadata": {}, "body": source}

    lines = source.splitlines()
    if normalize_text(lines[0]) != "---":
        return {"metadata": {}, "body": source}

    metadata = {}
    cursor = 1
    fm_lines = []

    for cursor in range(1, len(lines)):
        line = lines[cursor]
        if normalize_text(line) == "---":
            cursor += 1
            break
        fm_lines.append(line)
    else:
        cursor = len(lines)

    for line in fm_lines:
        match = re.match(r"^([^:]+):\s*(.*)$", line)
        if not match:
            continue
        key = normalize_key(match.group(1))
        key = re.sub(r"[^a-z0-9_]+", "_", key)
        metadata[key] = parse_front_matter_value(match.group(2))

    return {"metadata": metadata, "body": "\n".join(lines[cursor:])}


def extract_markdown_heading(text_value):
    match = re.search(r"^\s*#\s+(.+)$", str(text_value or ""), flags=re.MULTILINE)
    return normalize_text(match.group(1)) if match else None


def humanize_filename(file_path):
    base = Path(file_path).stem
    if not base:
        return "Planning Document"

    label = re.sub(r"[-_]+", " ", base)
    label = re.sub(r"\s+", " ", label).strip()
    return label.title()


def create_checksum(value):
    return hashlib.sha256(str(value or "").encode("utf-8")).hexdigest()


def tokenize(text_value):
    return [
        token
        for token in re.sub(r"[^a-z0-9\s]+", " ", normalize_text(text_value).lower()).split()
        if token
    ]


def build_embedding_features(tokens):
    features = list(tokens)
    features.extend(
        f"{tokens[index]}_{tokens[index + 1]}"
        for index in range(len(tokens) - 1)
    )
    return features


def hash_embedding(text_value, dimensions=DEFAULT_EMBEDDING_DIMENSIONS):
    vector = [0.0] * dimensions
    tokens = build_embedding_features(tokenize(text_value))
    if not tokens:
        return vector

    base_weight = 1 / max(len(tokens) ** 0.5, 1.0)

    for token in tokens:
        digest = hashlib.sha256(token.encode("utf-8")).digest()
        index_a = int.from_bytes(digest[0:4], "big") % dimensions
        index_b = int.from_bytes(digest[8:12], "big") % dimensions
        polarity = 1.0 if digest[4] % 2 == 0 else -1.0

        vector[index_a] += polarity * base_weight
        vector[index_b] += polarity * base_weight * 0.5

    magnitude = sum(value * value for value in vector) ** 0.5
    if not magnitude:
        return vector

    return [value / magnitude for value in vector]


def summarize_text(text_value, max_sentences=2, max_chars=320):
    normalized = normalize_text(text_value)
    if not normalized:
        return ""

    sentences = re.findall(r"[^.!?]+[.!?]+", normalized)
    summary = " ".join(sentences[:max_sentences]).strip() or normalized[:max_chars]
    summary = normalize_text(summary)
    if len(summary) > max_chars:
        return f"{summary[: max_chars - 1].rstrip()}…"
    return summary


def split_into_chunks(text_value, chunk_size=900, overlap=140):
    words = [word for word in normalize_text(text_value).split() if word]
    if not words:
        return []

    chunks = []
    step = max(chunk_size - overlap, 1)

    for start in range(0, len(words), step):
        chunk_words = words[start : start + chunk_size]
        if not chunk_words:
            break
        chunks.append(" ".join(chunk_words))
        if start + chunk_size >= len(words):
            break

    return chunks


def parse_document_envelope(content, fallback_title=None):
    envelope = parse_front_matter(content)
    front_matter = envelope["metadata"]
    body = envelope["body"]

    resolved_title = (
        normalize_text(front_matter.get("title"))
        or normalize_text(front_matter.get("name"))
        or normalize_text(fallback_title)
        or extract_markdown_heading(body)
        or "Planning Document"
    )

    district_scope = normalize_text(front_matter.get("district_scope") or front_matter.get("district")) or None
    ta_scope = normalize_text(front_matter.get("ta_scope") or front_matter.get("ta")) or None
    department_scope = normalize_text(
        front_matter.get("department_scope")
        or front_matter.get("department")
        or front_matter.get("topic")
    ) or None
    document_type = normalize_text(front_matter.get("document_type") or front_matter.get("type")) or "planning_document"
    tags_value = front_matter.get("tags") or front_matter.get("keywords") or []
    if not isinstance(tags_value, list):
        tags_value = [tags_value]
    tags = []
    for item in tags_value:
        tags.extend(
            normalize_text(part)
            for part in re.split(r"[;,]", str(item))
            if normalize_text(part)
        )

    summary = normalize_text(front_matter.get("summary")) or summarize_text(body, 2, 400)

    return {
        "title": resolved_title,
        "body": normalize_text(body),
        "district_scope": district_scope,
        "ta_scope": ta_scope,
        "department_scope": department_scope,
        "document_type": document_type,
        "tags": tags,
        "summary": summary,
        "front_matter": front_matter,
    }


def build_embedding_text(title, summary, body, tags, metadata):
    metadata_text = "\n".join(
        f"{key}: {', '.join(value) if isinstance(value, list) else value}"
        for key, value in (metadata or {}).items()
        if value not in {None, ""}
    )
    return "\n\n".join(
        part
        for part in [
            title,
            summary,
            f"Tags: {', '.join(tags)}" if tags else "",
            metadata_text,
            body,
        ]
        if part
    )


def build_source_key(source_type, source_path, source_filename, checksum):
    if source_path:
        return f"{normalize_key(source_type or 'file')}:{normalize_key(source_path)}"
    if source_filename and checksum:
        return f"{normalize_key(source_type or 'file')}:{normalize_key(source_filename)}:{checksum}"
    return f"{normalize_key(source_type or 'file')}:{checksum or create_checksum(os.urandom(8).hex())}"


def read_document_file(file_path):
    path_obj = Path(file_path)
    ext = path_obj.suffix.lower()
    if ext not in SUPPORTED_EXTENSIONS:
        raise ValueError(f"Unsupported planning document file type: {ext or 'unknown'}")

    if ext == ".json":
        try:
            return json.dumps(json.loads(path_obj.read_text(encoding="utf-8", errors="ignore")), indent=2, ensure_ascii=False)
        except Exception:
            return path_obj.read_text(encoding="utf-8", errors="ignore")

    if ext in {".html", ".htm"}:
        text_value = path_obj.read_text(encoding="utf-8", errors="ignore")
        text_value = re.sub(r"<script[\s\S]*?</script>", " ", text_value, flags=re.IGNORECASE)
        text_value = re.sub(r"<style[\s\S]*?</style>", " ", text_value, flags=re.IGNORECASE)
        text_value = re.sub(r"<[^>]+>", " ", text_value)
        return re.sub(r"\s+", " ", text_value).strip()

    if ext == ".csv":
        try:
            dataframe = pd.read_csv(path_obj)
            return dataframe.to_csv(index=False)
        except Exception:
            return path_obj.read_text(encoding="utf-8", errors="ignore")

    return path_obj.read_text(encoding="utf-8", errors="ignore")


def document_has_vector_column(session):
    if not table_exists(session, "planning_document_chunks"):
        return False

    query = text(
        """
        SELECT EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'planning_document_chunks'
            AND column_name = 'embedding_vector'
        )
        """
    )
    return bool(session.execute(query).scalar())


def ensure_document_tables_present(session):
    return table_exists(session, "planning_documents") and table_exists(session, "planning_document_chunks")


def replace_document_chunks(session, document_id, chunks):
    session.execute(
        text("DELETE FROM planning_document_chunks WHERE document_id = :document_id"),
        {"document_id": document_id},
    )

    has_vector = document_has_vector_column(session)
    vector_sql = ", embedding_vector" if has_vector else ""
    vector_value_sql = ", CAST(:embedding_vector AS vector)" if has_vector else ""

    insert_sql = text(
        f"""
        INSERT INTO planning_document_chunks (
          document_id,
          chunk_index,
          chunk_title,
          chunk_text,
          chunk_summary,
          citation_label,
          source_path,
          source_url,
          page_number,
          section_heading,
          embedding,
          metadata
          {vector_sql}
        )
        VALUES (
          :document_id,
          :chunk_index,
          :chunk_title,
          :chunk_text,
          :chunk_summary,
          :citation_label,
          :source_path,
          :source_url,
          :page_number,
          :section_heading,
          CAST(:embedding AS jsonb),
          CAST(:metadata AS jsonb)
          {vector_value_sql}
        )
        """
    )

    for chunk in chunks:
        embedding = hash_embedding(chunk["embedding_text"])
        params = {
            "document_id": document_id,
            "chunk_index": chunk["chunk_index"],
            "chunk_title": chunk["chunk_title"],
            "chunk_text": chunk["chunk_text"],
            "chunk_summary": chunk["chunk_summary"],
            "citation_label": chunk["citation_label"],
            "source_path": chunk["source_path"],
            "source_url": chunk["source_url"],
            "page_number": chunk["page_number"],
            "section_heading": chunk["section_heading"],
            "embedding": json.dumps(embedding),
            "metadata": json.dumps(chunk["metadata"]),
        }
        if has_vector:
            params["embedding_vector"] = "[" + ",".join(f"{value:.6f}" for value in embedding) + "]"
        session.execute(insert_sql, params)


def upsert_document(session, payload):
    if not ensure_document_tables_present(session):
        return None

    metadata = payload.get("metadata") or {}
    envelope = parse_document_envelope(payload["content"], payload.get("title") or payload.get("source_filename"))
    resolved_title = normalize_text(
        payload.get("title")
        or metadata.get("title")
        or envelope["title"]
        or payload.get("source_filename")
        or "Planning Document"
    )
    resolved_content = normalize_text(envelope["body"])
    resolved_summary = normalize_text(payload.get("summary")) or envelope["summary"]
    resolved_district_scope = normalize_text(payload.get("district_scope") or metadata.get("district_scope") or envelope["district_scope"]) or None
    resolved_ta_scope = normalize_text(payload.get("ta_scope") or metadata.get("ta_scope") or envelope["ta_scope"]) or None
    resolved_department_scope = normalize_text(payload.get("department_scope") or metadata.get("department_scope") or envelope["department_scope"]) or None
    resolved_document_type = normalize_text(payload.get("document_type") or metadata.get("document_type") or envelope["document_type"]) or "planning_document"
    resolved_tags = list(dict.fromkeys(envelope["tags"] + [normalize_text(tag) for tag in metadata.get("tags", []) if normalize_text(tag)]))
    checksum = create_checksum(
        "::".join(
            [
                resolved_title,
                resolved_content,
                resolved_document_type,
                resolved_district_scope or "",
                resolved_ta_scope or "",
                resolved_department_scope or "",
                json.dumps(metadata, sort_keys=True, ensure_ascii=False),
            ]
        )
    )
    source_key = normalize_text(
        payload.get("source_key")
        or build_source_key(
            payload.get("source_type"),
            payload.get("source_path"),
            payload.get("source_filename"),
            checksum,
        )
    )

    document_metadata = {
        **metadata,
        **envelope["front_matter"],
        "tags": resolved_tags,
        "source_kind": payload.get("source_type") or "file",
        "source_filename": payload.get("source_filename"),
        "source_path": payload.get("source_path"),
        "source_url": payload.get("source_url"),
        "checksum": checksum,
    }

    document_params = {
        "source_key": source_key,
        "title": resolved_title,
        "document_type": resolved_document_type,
        "source_type": payload.get("source_type") or "file",
        "source_path": payload.get("source_path"),
        "source_url": payload.get("source_url"),
        "source_filename": payload.get("source_filename"),
        "district_scope": resolved_district_scope,
        "ta_scope": resolved_ta_scope,
        "department_scope": resolved_department_scope,
        "summary": resolved_summary,
        "content": resolved_content,
        "checksum": checksum,
        "metadata": json.dumps(document_metadata, ensure_ascii=False),
        "uploaded_by_user_id": payload.get("uploaded_by_user_id"),
    }

    document_result = session.execute(
        text(
            """
            INSERT INTO planning_documents (
              source_key,
              title,
              document_type,
              source_type,
              source_path,
              source_url,
              source_filename,
              district_scope,
              ta_scope,
              department_scope,
              summary,
              content,
              checksum,
              metadata,
              uploaded_by_user_id,
              updated_at
            )
            VALUES (
              :source_key,
              :title,
              :document_type,
              :source_type,
              :source_path,
              :source_url,
              :source_filename,
              :district_scope,
              :ta_scope,
              :department_scope,
              :summary,
              :content,
              :checksum,
              CAST(:metadata AS jsonb),
              :uploaded_by_user_id,
              CURRENT_TIMESTAMP
            )
            ON CONFLICT (source_key)
            DO UPDATE SET
              title = EXCLUDED.title,
              document_type = EXCLUDED.document_type,
              source_type = EXCLUDED.source_type,
              source_path = EXCLUDED.source_path,
              source_url = EXCLUDED.source_url,
              source_filename = EXCLUDED.source_filename,
              district_scope = EXCLUDED.district_scope,
              ta_scope = EXCLUDED.ta_scope,
              department_scope = EXCLUDED.department_scope,
              summary = EXCLUDED.summary,
              content = EXCLUDED.content,
              checksum = EXCLUDED.checksum,
              metadata = EXCLUDED.metadata,
              uploaded_by_user_id = EXCLUDED.uploaded_by_user_id,
              updated_at = CURRENT_TIMESTAMP
            RETURNING id
            """
        ),
        document_params,
    )
    document_id = document_result.scalar()

    chunks = split_into_chunks(resolved_content)
    chunk_records = []
    for index, chunk_text in enumerate(chunks):
        section_heading = extract_markdown_heading(resolved_content) if index == 0 else f"Section {index + 1}"
        chunk_records.append(
            {
                "chunk_index": index,
                "chunk_text": chunk_text,
                "chunk_title": f"{resolved_title} - {section_heading or f'Chunk {index + 1}'}",
                "chunk_summary": summarize_text(chunk_text, 2, 260),
                "citation_label": f"{resolved_title} - {section_heading or f'Chunk {index + 1}'}",
                "source_path": payload.get("source_path"),
                "source_url": payload.get("source_url"),
                "page_number": None,
                "section_heading": section_heading,
                "metadata": {
                    "tags": resolved_tags,
                    "title": resolved_title,
                    "document_type": resolved_document_type,
                    "district_scope": resolved_district_scope,
                    "ta_scope": resolved_ta_scope,
                    "department_scope": resolved_department_scope,
                    "source_filename": payload.get("source_filename"),
                    "chunk_index": index,
                },
                "embedding_text": build_embedding_text(
                    resolved_title,
                    resolved_summary,
                    chunk_text,
                    resolved_tags,
                    document_metadata,
                ),
            }
        )

    if not chunk_records:
        chunk_records.append(
            {
                "chunk_index": 0,
                "chunk_text": resolved_content or resolved_summary or resolved_title,
                "chunk_title": f"{resolved_title} - Overview",
                "chunk_summary": summarize_text(resolved_content or resolved_summary or resolved_title, 2, 260),
                "citation_label": f"{resolved_title} - Overview",
                "source_path": payload.get("source_path"),
                "source_url": payload.get("source_url"),
                "page_number": None,
                "section_heading": "Overview",
                "metadata": {
                    "tags": resolved_tags,
                    "title": resolved_title,
                    "document_type": resolved_document_type,
                    "district_scope": resolved_district_scope,
                    "ta_scope": resolved_ta_scope,
                    "department_scope": resolved_department_scope,
                    "source_filename": payload.get("source_filename"),
                    "chunk_index": 0,
                },
                "embedding_text": build_embedding_text(
                    resolved_title,
                    resolved_summary,
                    resolved_content or resolved_summary or resolved_title,
                    resolved_tags,
                    document_metadata,
                ),
            }
        )

    replace_document_chunks(session, document_id, chunk_records)
    session.commit()

    return {
        "document_id": document_id,
        "chunk_count": len(chunk_records),
        "title": resolved_title,
        "checksum": checksum,
        "source_key": source_key,
        "district_scope": resolved_district_scope,
        "ta_scope": resolved_ta_scope,
        "department_scope": resolved_department_scope,
    }


def ingest_planning_document_file(session, file_path, **options):
    content = read_document_file(file_path)
    return upsert_document(
        session,
        {
            **options,
            "content": content,
            "source_path": options.get("source_path") or os.path.abspath(file_path),
            "source_filename": options.get("source_filename") or Path(file_path).name,
        },
    )


def walk_planning_document_files(root_dir):
    root_path = Path(root_dir)
    if not root_path.exists():
        return []

    files = []
    for path_obj in root_path.rglob("*"):
        if path_obj.is_file() and path_obj.suffix.lower() in SUPPORTED_EXTENSIONS:
            files.append(path_obj)
    return files


def sync_planning_documents(session, source_dir, source_type="etl", uploaded_by_user_id=None, default_metadata=None):
    default_metadata = default_metadata or {}
    if not ensure_document_tables_present(session):
        return {
            "documents_indexed": 0,
            "chunks_indexed": 0,
            "skipped": 0,
            "documents": [],
        }

    source_root = Path(source_dir)
    if not source_root.exists():
        return {
            "documents_indexed": 0,
            "chunks_indexed": 0,
            "skipped": 0,
            "documents": [],
        }

    stats = {
        "documents_indexed": 0,
        "chunks_indexed": 0,
        "skipped": 0,
        "documents": [],
    }

    for file_path in walk_planning_document_files(source_root):
        try:
            content = read_document_file(file_path)
            envelope = parse_document_envelope(content, humanize_filename(file_path))
            relative_source_path = os.path.relpath(str(file_path), start=str(Path.cwd())).replace(os.sep, "/")
            result = upsert_document(
                session,
                {
                    "content": content,
                    "title": envelope["title"],
                    "source_type": source_type,
                    "source_path": relative_source_path,
                    "source_filename": file_path.name,
                    "district_scope": envelope["district_scope"],
                    "ta_scope": envelope["ta_scope"],
                    "department_scope": envelope["department_scope"],
                    "document_type": envelope["document_type"],
                    "metadata": {
                        **default_metadata,
                        **envelope["front_matter"],
                        "source_kind": source_type,
                    },
                    "summary": envelope["summary"],
                    "uploaded_by_user_id": uploaded_by_user_id,
                },
            )
            stats["documents_indexed"] += 1
            stats["chunks_indexed"] += result["chunk_count"]
            stats["documents"].append(result)
        except Exception:
            session.rollback()
            stats["skipped"] += 1

    return stats
