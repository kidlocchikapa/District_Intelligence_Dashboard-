const crypto = require("crypto");
const fs = require("fs/promises");
const path = require("path");

const db = require("../db");

const DEFAULT_EMBEDDING_DIMENSIONS = 1536;
const DEFAULT_CHUNK_SIZE = 900;
const DEFAULT_CHUNK_OVERLAP = 140;
const DEFAULT_TOP_K = 5;
const DEFAULT_CANDIDATE_LIMIT = 220;
const SUPPORTED_TEXT_EXTENSIONS = new Set([
  ".txt",
  ".md",
  ".markdown",
  ".json",
  ".csv",
  ".html",
  ".htm",
  ".pdf",
]);

const GREETING_PATTERNS = [
  /^(hello|hi|hey|greetings|good\s*(morning|afternoon|evening)|howdy|yo|sup)\b/i,
  /^(what'?s\s*up|how\s*(are|'?re)\s*(you|u)|howdy|nice\s*to\s*meet)/i,
  /^(thanks|thank\s*you|thx|ty)\s*$/i,
];

function isGreeting(query) {
  const normalized = String(query || "").trim().toLowerCase();
  if (normalized.length > 80) return false;
  return GREETING_PATTERNS.some((pattern) => pattern.test(normalized));
}

function greetingResponse() {
  return [
    "## Hello!",
    "I'm the District Intelligence planning assistant. I can help you with:",
    "",
    "- **District overview** — population, education, health, and welfare metrics",
    "- **Spatial analysis** — school coverage, health facility access, flood risk",
    "- **Planning recommendations** — evidence-based actions for your area",
    "- **Data insights** — trends and summaries from the latest ETL pipeline",
    "",
    "I don't have information about personal topics, current events outside this dashboard, or general knowledge. Please ask me something about the district data!",
    "",
    "**Try asking:** \"What's the education coverage in Zomba?\" or \"Show me health facility access metrics.\"",
  ].join("\n");
}

const SYSTEM_PROMPT = `
You are the district planning intelligence assistant for a District Intelligence Dashboard.
Your role: answer questions using the supplied evidence from planning documents and the live analysis data fetched from the database.
The database contains analysis_results (education, health, welfare, disaster metrics), unified_indicators (population data), and planning documents.

Rules:
1. Use the supplied evidence and analysis data when possible. If evidence is thin, say so clearly.
2. If the user asks a personal question or a question unrelated to the dashboard, politely state you can only answer district-related questions.
3. Be practical, policy-aware, and concise.
4. Always ground recommendations in the retrieved data and preserve citation numbers.
5. Avoid vague management speak. Prefer concrete actions, sequencing, and implementation details.
6. If the retrieved evidence does not support a claim, label it as a planning inference.
7. When analysis data is available (e.g., school coverage %, health facility counts, population figures), use it directly in your answer.
`.trim();

let schemaPromise = null;
let vectorSupportPromise = null;

function normalizeText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeKey(value) {
  return normalizeText(value).toLowerCase();
}

function truthyText(value) {
  const normalized = normalizeKey(value);
  return Boolean(
    normalized &&
      !["all", "national", "malawi", "overview", "general"].includes(normalized),
  );
}

function toArray(value) {
  if (Array.isArray(value)) {
    return value;
  }

  if (value === undefined || value === null || value === "") {
    return [];
  }

  return [value];
}

function parseFrontMatterValue(value) {
  const trimmed = normalizeText(value);
  if (!trimmed) {
    return "";
  }

  if (
    (trimmed.startsWith("[") && trimmed.endsWith("]")) ||
    (trimmed.startsWith("{") && trimmed.endsWith("}"))
  ) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return trimmed;
    }
  }

  if (trimmed.includes(",")) {
    return trimmed
      .split(",")
      .map((entry) => normalizeText(entry))
      .filter(Boolean);
  }

  return trimmed.replace(/^['"]|['"]$/g, "");
}

function parseFrontMatter(text) {
  const source = String(text || "");
  if (!source.trimStart().startsWith("---")) {
    return { metadata: {}, body: source };
  }

  const lines = source.split(/\r?\n/);
  if (normalizeText(lines[0]) !== "---") {
    return { metadata: {}, body: source };
  }

  const metadata = {};
  let cursor = 1;
  const frontMatterLines = [];

  for (; cursor < lines.length; cursor += 1) {
    const line = lines[cursor];
    if (normalizeText(line) === "---") {
      cursor += 1;
      break;
    }
    frontMatterLines.push(line);
  }

  frontMatterLines.forEach((line) => {
    const match = line.match(/^([^:]+):\s*(.*)$/);
    if (!match) {
      return;
    }

    const key = normalizeKey(match[1]).replace(/[^a-z0-9_]+/g, "_");
    metadata[key] = parseFrontMatterValue(match[2]);
  });

  return {
    metadata,
    body: lines.slice(cursor).join("\n"),
  };
}

function extractMarkdownHeading(text) {
  const match = String(text || "").match(/^\s*#\s+(.+)$/m);
  return match ? normalizeText(match[1]) : null;
}

function humanizeFilename(filePath) {
  const base = path.basename(filePath || "", path.extname(filePath || ""));
  if (!base) {
    return "Planning Document";
  }

  return base
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function buildSourceKey({ sourceType, sourcePath, sourceFilename, checksum }) {
  if (sourcePath) {
    return `${normalizeKey(sourceType || "file")}:${normalizeKey(sourcePath)}`;
  }

  if (sourceFilename && checksum) {
    return `${normalizeKey(sourceType || "file")}:${normalizeKey(sourceFilename)}:${checksum}`;
  }

  return `${normalizeKey(sourceType || "file")}:${checksum || crypto.randomUUID()}`;
}

function buildSafeCitationTitle(title, sectionHeading) {
  const head = normalizeText(title) || "Planning Document";
  const tail = normalizeText(sectionHeading);
  return tail ? `${head} - ${tail}` : head;
}

function summarizeText(text, maxSentences = 2, maxChars = 320) {
  const normalized = normalizeText(text);
  if (!normalized) {
    return "";
  }

  const sentenceMatches = normalized.match(/[^.!?]+[.!?]+/g) || [];
  const selected = sentenceMatches.slice(0, maxSentences).join(" ");
  const summary = normalizeText(selected || normalized.slice(0, maxChars));
  return summary.length > maxChars
    ? `${summary.slice(0, maxChars - 1).trimEnd()}…`
    : summary;
}

function splitIntoChunks(text, chunkSize = DEFAULT_CHUNK_SIZE, overlap = DEFAULT_CHUNK_OVERLAP) {
  const words = normalizeText(text)
    .split(/\s+/)
    .filter(Boolean);

  if (!words.length) {
    return [];
  }

  const chunks = [];
  const step = Math.max(chunkSize - overlap, 1);

  for (let start = 0; start < words.length; start += step) {
    const chunkWords = words.slice(start, start + chunkSize);
    if (!chunkWords.length) {
      break;
    }

    chunks.push(chunkWords.join(" "));

    if (start + chunkSize >= words.length) {
      break;
    }
  }

  return chunks;
}

function tokenize(text) {
  return normalizeText(text)
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function buildEmbeddingFeatures(tokens) {
  const features = [...tokens];

  for (let index = 0; index < tokens.length - 1; index += 1) {
    features.push(`${tokens[index]}_${tokens[index + 1]}`);
  }

  return features;
}

function hashEmbedding(text, dimensions = DEFAULT_EMBEDDING_DIMENSIONS) {
  const vector = new Array(dimensions).fill(0);
  const tokens = buildEmbeddingFeatures(tokenize(text));

  if (!tokens.length) {
    return vector;
  }

  const baseWeight = 1 / Math.sqrt(tokens.length);

  tokens.forEach((token) => {
    const hash = crypto.createHash("sha256").update(token).digest();
    const indexA = hash.readUInt32BE(0) % dimensions;
    const indexB = hash.readUInt32BE(8) % dimensions;
    const polarity = hash[4] % 2 === 0 ? 1 : -1;

    vector[indexA] += polarity * baseWeight;
    vector[indexB] += polarity * baseWeight * 0.5;
  });

  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + (value * value), 0));
  if (!magnitude) {
    return vector;
  }

  return vector.map((value) => value / magnitude);
}

function cosineSimilarity(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || !left.length || !right.length) {
    return 0;
  }

  const length = Math.min(left.length, right.length);
  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;

  for (let index = 0; index < length; index += 1) {
    const leftValue = Number(left[index] || 0);
    const rightValue = Number(right[index] || 0);
    dot += leftValue * rightValue;
    leftMagnitude += leftValue * leftValue;
    rightMagnitude += rightValue * rightValue;
  }

  if (!leftMagnitude || !rightMagnitude) {
    return 0;
  }

  return dot / (Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude));
}

function jaccardSimilarity(leftTokens, rightTokens) {
  const leftSet = new Set(leftTokens);
  const rightSet = new Set(rightTokens);

  if (!leftSet.size || !rightSet.size) {
    return 0;
  }

  let intersection = 0;
  leftSet.forEach((token) => {
    if (rightSet.has(token)) {
      intersection += 1;
    }
  });

  const union = leftSet.size + rightSet.size - intersection;
  return union ? intersection / union : 0;
}

function toVectorLiteral(vector) {
  return `[${vector.map((value) => Number(value || 0).toFixed(6)).join(",")}]`;
}

function createChecksum(value) {
  return crypto.createHash("sha256").update(String(value || ""), "utf8").digest("hex");
}

function parseDocumentContent(buffer, fileName) {
  const ext = path.extname(fileName || "").toLowerCase();
  const text = buffer.toString("utf8");

  if (ext === ".json") {
    try {
      const parsed = JSON.parse(text);
      return JSON.stringify(parsed, null, 2);
    } catch {
      return text;
    }
  }

  if (ext === ".html" || ext === ".htm") {
    return text
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  return text;
}

function parseDocumentEnvelope(content, fallbackTitle = null) {
  const { metadata: frontMatter, body } = parseFrontMatter(content);
  const resolvedTitle =
    normalizeText(frontMatter.title) ||
    normalizeText(frontMatter.name) ||
    normalizeText(fallbackTitle) ||
    extractMarkdownHeading(body) ||
    "Planning Document";

  const districtScope =
    normalizeText(frontMatter.district_scope) ||
    normalizeText(frontMatter.district) ||
    null;
  const taScope =
    normalizeText(frontMatter.ta_scope) ||
    normalizeText(frontMatter.ta) ||
    null;
  const departmentScope =
    normalizeText(frontMatter.department_scope) ||
    normalizeText(frontMatter.department) ||
    normalizeText(frontMatter.topic) ||
    null;
  const documentType =
    normalizeText(frontMatter.document_type) ||
    normalizeText(frontMatter.type) ||
    "planning_document";

  const tagsValue = frontMatter.tags || frontMatter.keywords || [];
  const tags = toArray(tagsValue)
    .flatMap((item) => String(item).split(/[;,]/))
    .map((item) => normalizeText(item))
    .filter(Boolean);

  const summary =
    normalizeText(frontMatter.summary) ||
    summarizeText(body, 2, 400);

  return {
    title: resolvedTitle,
    body: normalizeText(body),
    districtScope,
    taScope,
    departmentScope,
    documentType,
    tags,
    summary,
    frontMatter,
  };
}

function buildEmbeddingText({ title, summary, body, tags, metadata }) {
  const metadataText = Object.entries(metadata || {})
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(", ") : value}`)
    .join("\n");

  return [
    title,
    summary,
    Array.isArray(tags) && tags.length ? `Tags: ${tags.join(", ")}` : "",
    metadataText,
    body,
  ]
    .filter(Boolean)
    .join("\n\n");
}

function scoreDocumentChunk({ queryTokens, queryVector, chunkEmbedding, text, doc, context, vectorSimilarity = null }) {
  const chunkTokens = tokenize(text);
  const lexicalScore = jaccardSimilarity(queryTokens, chunkTokens);
  const semanticScore = Array.isArray(chunkEmbedding)
    ? cosineSimilarity(queryVector, chunkEmbedding)
    : 0;
  const vectorScore = Number.isFinite(vectorSimilarity) ? vectorSimilarity : semanticScore;
  const loweredText = normalizeKey(text);
  const loweredTitle = normalizeKey(doc.title);
  const loweredSummary = normalizeKey(doc.summary);
  const loweredQuery = normalizeKey(context?.query || "");
  let scopeBoost = 0;

  if (context?.district && truthyText(doc.district_scope) && normalizeKey(doc.district_scope) === normalizeKey(context.district)) {
    scopeBoost += 0.1;
  } else if (!truthyText(doc.district_scope)) {
    scopeBoost += 0.04;
  }

  if (context?.ta && truthyText(doc.ta_scope) && normalizeKey(doc.ta_scope) === normalizeKey(context.ta)) {
    scopeBoost += 0.08;
  } else if (!truthyText(doc.ta_scope)) {
    scopeBoost += 0.03;
  }

  if (context?.department && truthyText(doc.department_scope) && normalizeKey(doc.department_scope) === normalizeKey(context.department)) {
    scopeBoost += 0.05;
  }

  if (context?.metricId) {
    const metricKey = normalizeKey(context.metricId);
    if (loweredText.includes(metricKey) || loweredTitle.includes(metricKey) || loweredSummary.includes(metricKey)) {
      scopeBoost += 0.05;
    }
  }

  if (loweredQuery && (loweredText.includes(loweredQuery) || loweredTitle.includes(loweredQuery))) {
    scopeBoost += 0.03;
  }

  const recencyBoost = doc.document_updated_at
    ? Math.max(0, 0.05 - (Math.max(Date.now() - new Date(doc.document_updated_at).getTime(), 0) / (1000 * 60 * 60 * 24 * 365)))
    : 0;

  return (vectorScore * 0.7) + (lexicalScore * 0.2) + scopeBoost + recencyBoost;
}

function buildDefaultContext(context = {}) {
  return {
    district: normalizeText(context.district) || null,
    ta: normalizeText(context.ta) || null,
    metricId: normalizeText(context.metricId) || null,
    metricLabel: normalizeText(context.metricLabel) || null,
    department: normalizeText(context.department) || null,
    scopeLabel: normalizeText(context.scopeLabel) || null,
    sourceHint: normalizeText(context.sourceHint) || null,
    query: normalizeText(context.query) || null,
  };
}

function buildAugmentedQuery(query, context = {}) {
  return [
    normalizeText(query),
    context.scopeLabel ? `Scope: ${context.scopeLabel}` : "",
    context.district ? `District: ${context.district}` : "",
    context.ta ? `TA: ${context.ta}` : "",
    context.department ? `Department: ${context.department}` : "",
    context.metricId ? `Metric: ${context.metricId}` : "",
    context.metricLabel ? `Metric label: ${context.metricLabel}` : "",
    context.sourceHint ? `Source hint: ${context.sourceHint}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function buildFallbackRecommendations(retrievedDocuments, query, mode) {
  const actionSentences = [];
  const actionRegex = /(?:should|must|priorit(?:ize|ise)|strengthen|expand|coordinate|review|align|deliver|target|prepare|improve)[^.?!]{0,220}[.?!]/gi;

  retrievedDocuments.forEach((doc) => {
    const matches = String(doc.excerpt || doc.chunk_text || "")
      .match(actionRegex) || [];
    matches.forEach((match) => {
      const cleaned = normalizeText(match);
      if (cleaned && !actionSentences.includes(cleaned)) {
        actionSentences.push(cleaned);
      }
    });
  });

  const defaultBullets = [
    "Sequence low-cost, high-impact actions first so the district can move quickly while larger investments are prepared.",
    "Use the retrieved planning documents to validate which interventions are already approved or piloted elsewhere.",
    "Track implementation by TA and revisit the recommendation after the next ETL refresh.",
  ];

  const bullets = actionSentences.slice(0, 3);
  while (bullets.length < 3) {
    bullets.push(defaultBullets[bullets.length]);
  }

  const title = mode === "report"
    ? "Draft report section"
    : mode === "recommendations"
      ? "Priority recommendations"
      : "Planning response";

  const intro = mode === "report"
    ? `Draft analysis for: ${normalizeText(query) || "district planning brief"}`
    : `Evidence-based response for: ${normalizeText(query) || "district planning question"}`;

  return [
    `## ${title}`,
    intro,
    "",
    "## Recommended actions",
    ...bullets.map((bullet, index) => `${index + 1}. ${bullet}`),
  ].join("\n");
}

function markdownSectionsFromText(text) {
  const sections = [];
  const lines = String(text || "").split(/\r?\n/);
  let currentHeading = "Response";
  let currentLines = [];

  const flush = () => {
    const body = normalizeText(currentLines.join("\n"));
    if (body) {
      sections.push({
        heading: currentHeading,
        body,
      });
    }
  };

  lines.forEach((line) => {
    const headingMatch = line.match(/^##\s+(.+)$/);
    if (headingMatch) {
      flush();
      currentHeading = normalizeText(headingMatch[1]);
      currentLines = [];
      return;
    }

    currentLines.push(line);
  });

  flush();
  return sections.length ? sections : [{ heading: "Response", body: normalizeText(text) }];
}

async function ensurePlanningSchema() {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      await db.query(`
        CREATE TABLE IF NOT EXISTS planning_documents (
          id SERIAL PRIMARY KEY,
          source_key TEXT NOT NULL UNIQUE,
          title TEXT NOT NULL,
          document_type VARCHAR(100) NOT NULL DEFAULT 'planning_document',
          source_type VARCHAR(50) NOT NULL DEFAULT 'file',
          source_path TEXT,
          source_url TEXT,
          source_filename TEXT,
          district_scope VARCHAR(255),
          ta_scope VARCHAR(255),
          department_scope VARCHAR(100),
          summary TEXT,
          content TEXT,
          checksum VARCHAR(128),
          metadata JSONB DEFAULT '{}'::jsonb,
          uploaded_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      await db.query(`
        CREATE TABLE IF NOT EXISTS planning_document_chunks (
          id SERIAL PRIMARY KEY,
          document_id INTEGER NOT NULL REFERENCES planning_documents(id) ON DELETE CASCADE,
          chunk_index INTEGER NOT NULL,
          chunk_title TEXT,
          chunk_text TEXT NOT NULL,
          chunk_summary TEXT,
          citation_label TEXT,
          source_path TEXT,
          source_url TEXT,
          page_number INTEGER,
          section_heading TEXT,
          embedding JSONB NOT NULL,
          metadata JSONB DEFAULT '{}'::jsonb,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          UNIQUE (document_id, chunk_index)
        )
      `);

      await db.query(`
        CREATE TABLE IF NOT EXISTS ai_query_logs (
          id SERIAL PRIMARY KEY,
          user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
          query_type VARCHAR(50) NOT NULL,
          query_text TEXT NOT NULL,
          district_name VARCHAR(255),
          ta_name VARCHAR(255),
          metric_id VARCHAR(150),
          metric_label VARCHAR(255),
          query_context JSONB DEFAULT '{}'::jsonb,
          response_text TEXT,
          response_json JSONB DEFAULT '{}'::jsonb,
          retrieval_count INTEGER DEFAULT 0,
          sources_count INTEGER DEFAULT 0,
          latency_ms INTEGER,
          status VARCHAR(50) NOT NULL DEFAULT 'success',
          error_message TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      await db.query(`CREATE INDEX IF NOT EXISTS idx_planning_documents_source_key ON planning_documents(source_key)`);
      await db.query(`CREATE INDEX IF NOT EXISTS idx_planning_documents_scope ON planning_documents(department_scope, district_scope, ta_scope)`);
      await db.query(`CREATE INDEX IF NOT EXISTS idx_planning_document_chunks_document_id ON planning_document_chunks(document_id, chunk_index)`);
      await db.query(`CREATE INDEX IF NOT EXISTS idx_planning_document_chunks_created_at ON planning_document_chunks(created_at DESC)`);
      await db.query(`CREATE INDEX IF NOT EXISTS idx_ai_query_logs_user_created_at ON ai_query_logs(user_id, created_at DESC)`);
      await db.query(`CREATE INDEX IF NOT EXISTS idx_ai_query_logs_type_created_at ON ai_query_logs(query_type, created_at DESC)`);

      const vectorAvailableResult = await db.query(`
        SELECT EXISTS (
          SELECT 1
          FROM pg_available_extensions
          WHERE name = 'vector'
        ) AS available
      `);

      const vectorAvailable = Boolean(vectorAvailableResult.rows[0]?.available);
      if (vectorAvailable) {
        await db.query(`CREATE EXTENSION IF NOT EXISTS vector`);
        await db.query(`
          ALTER TABLE planning_document_chunks
          ADD COLUMN IF NOT EXISTS embedding_vector vector(${DEFAULT_EMBEDDING_DIMENSIONS})
        `);
        try {
          await db.query(`
            CREATE INDEX IF NOT EXISTS idx_planning_document_chunks_embedding_vector
            ON planning_document_chunks
            USING ivfflat (embedding_vector vector_cosine_ops)
            WITH (lists = 32)
          `);
        } catch {
          // Index creation can fail on tiny test datasets or environments that do not
          // fully support ivfflat yet. Retrieval will fall back to JS scoring.
        }
      }
    })().catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }

  return schemaPromise;
}

async function hasVectorSupport() {
  if (vectorSupportPromise) {
    return vectorSupportPromise;
  }

  vectorSupportPromise = (async () => {
    await ensurePlanningSchema();
    const result = await db.query(`
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'planning_document_chunks'
          AND column_name = 'embedding_vector'
      ) AS has_vector
    `);

    return Boolean(result.rows[0]?.has_vector);
  })().catch((error) => {
    vectorSupportPromise = null;
    throw error;
  });

  return vectorSupportPromise;
}

async function upsertPlanningDocument(client, payload) {
  const result = await client.query(
    `
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
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb, $15, CURRENT_TIMESTAMP
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
    `,
    [
      payload.sourceKey,
      payload.title,
      payload.documentType || "planning_document",
      payload.sourceType || "file",
      payload.sourcePath || null,
      payload.sourceUrl || null,
      payload.sourceFilename || null,
      payload.districtScope || null,
      payload.taScope || null,
      payload.departmentScope || null,
      payload.summary || null,
      payload.content || null,
      payload.checksum || null,
      JSON.stringify(payload.metadata || {}),
      payload.uploadedByUserId || null,
    ],
  );

  return result.rows[0].id;
}

async function clearDocumentChunks(client, documentId) {
  await client.query(
    `DELETE FROM planning_document_chunks WHERE document_id = $1`,
    [documentId],
  );
}

async function insertPlanningChunks(client, documentId, chunks, options = {}) {
  const vectorEnabled = await hasVectorSupport();
  let inserted = 0;

  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index];
    const chunkEmbedding = hashEmbedding(chunk.embeddingText, DEFAULT_EMBEDDING_DIMENSIONS);
    const embeddingJson = JSON.stringify(chunkEmbedding);
    const vectorLiteral = vectorEnabled ? toVectorLiteral(chunkEmbedding) : null;

    const columns = [
      "document_id",
      "chunk_index",
      "chunk_title",
      "chunk_text",
      "chunk_summary",
      "citation_label",
      "source_path",
      "source_url",
      "page_number",
      "section_heading",
      "embedding",
      "metadata",
    ];

    const values = [
      documentId,
      index,
      chunk.chunkTitle || null,
      chunk.chunkText,
      chunk.chunkSummary || null,
      chunk.citationLabel || null,
      chunk.sourcePath || null,
      chunk.sourceUrl || null,
      chunk.pageNumber || null,
      chunk.sectionHeading || null,
      embeddingJson,
      JSON.stringify(chunk.metadata || {}),
    ];

    const placeholders = values.map((_, valueIndex) =>
      valueIndex === 10 || valueIndex === 11
        ? `$${valueIndex + 1}::jsonb`
        : `$${valueIndex + 1}`,
    );

    if (vectorEnabled) {
      columns.push("embedding_vector");
      values.push(vectorLiteral);
      placeholders.push(`$${values.length}::vector`);
    }

    await client.query(
      `
        INSERT INTO planning_document_chunks (${columns.join(", ")})
        VALUES (${placeholders.join(", ")})
      `,
      values,
    );

    inserted += 1;
  }

  return inserted;
}

function buildChunkRecords({
  title,
  body,
  summary,
  sourcePath,
  sourceUrl,
  sourceFilename,
  districtScope,
  taScope,
  departmentScope,
  documentType,
  metadata,
  tags,
  chunkSize = DEFAULT_CHUNK_SIZE,
  chunkOverlap = DEFAULT_CHUNK_OVERLAP,
}) {
  const sourceChunks = splitIntoChunks(body, chunkSize, chunkOverlap);
  const chunkRecords = sourceChunks.map((chunkText, index) => {
    const sectionHeading = index === 0
      ? extractMarkdownHeading(body) || normalizeText(title)
      : `Section ${index + 1}`;

    return {
      chunkText,
      chunkTitle: buildSafeCitationTitle(title, sectionHeading),
      chunkSummary: summarizeText(chunkText, 2, 260),
      citationLabel: buildSafeCitationTitle(title, sectionHeading),
      sourcePath: sourcePath || null,
      sourceUrl: sourceUrl || null,
      pageNumber: null,
      sectionHeading,
      metadata: {
        ...metadata,
        tags,
        title,
        document_type: documentType,
        district_scope: districtScope,
        ta_scope: taScope,
        department_scope: departmentScope,
        source_filename: sourceFilename,
        chunk_index: index,
      },
      embeddingText: buildEmbeddingText({
        title,
        summary,
        body: chunkText,
        tags,
        metadata,
      }),
    };
  });

  if (!chunkRecords.length) {
    const chunkText = normalizeText(body || summary || title);
    chunkRecords.push({
      chunkText,
      chunkTitle: buildSafeCitationTitle(title, "Overview"),
      chunkSummary: summarizeText(chunkText, 2, 260),
      citationLabel: buildSafeCitationTitle(title, "Overview"),
      sourcePath: sourcePath || null,
      sourceUrl: sourceUrl || null,
      pageNumber: null,
      sectionHeading: "Overview",
      metadata: {
        ...metadata,
        tags,
        title,
        document_type: documentType,
        district_scope: districtScope,
        ta_scope: taScope,
        department_scope: departmentScope,
        source_filename: sourceFilename,
        chunk_index: 0,
      },
      embeddingText: buildEmbeddingText({
        title,
        summary,
        body: chunkText,
        tags,
        metadata,
      }),
    });
  }

  return chunkRecords;
}

async function ingestPlanningDocument({
  content,
  sourceType = "file",
  sourcePath = null,
  sourceUrl = null,
  sourceFilename = null,
  sourceKey = null,
  title = null,
  districtScope = null,
  taScope = null,
  departmentScope = null,
  documentType = "planning_document",
  metadata = {},
  summary = null,
  uploadedByUserId = null,
}) {
  await ensurePlanningSchema();

  const envelope = parseDocumentEnvelope(content, title || sourceFilename || sourcePath);
  const resolvedMetadata = {
    ...envelope.frontMatter,
    ...metadata,
  };

  const resolvedDocumentType = normalizeText(
    metadata.document_type || metadata.documentType || envelope.documentType || documentType,
  ) || "planning_document";
  const resolvedTitle =
    normalizeText(title) ||
    normalizeText(resolvedMetadata.title) ||
    envelope.title ||
    "Planning Document";
  const resolvedDistrictScope = normalizeText(
    districtScope || metadata.districtScope || resolvedMetadata.district_scope || envelope.districtScope,
  ) || null;
  const resolvedTaScope = normalizeText(
    taScope || metadata.taScope || resolvedMetadata.ta_scope || envelope.taScope,
  ) || null;
  const resolvedDepartmentScope = normalizeText(
    departmentScope || metadata.departmentScope || resolvedMetadata.department_scope || envelope.departmentScope,
  ) || null;
  const resolvedSummary =
    normalizeText(summary) ||
    normalizeText(resolvedMetadata.summary) ||
    envelope.summary ||
    summarizeText(envelope.body, 2, 400);
  const resolvedContent = normalizeText(envelope.body);
  const checksum = createChecksum(
    [
      resolvedTitle,
      resolvedDocumentType,
      resolvedDistrictScope,
      resolvedTaScope,
      resolvedDepartmentScope,
      resolvedContent,
      JSON.stringify(resolvedMetadata),
    ].join("::"),
  );
  const finalSourceKey = normalizeText(
    sourceKey || buildSourceKey({ sourceType, sourcePath, sourceFilename, checksum }),
  );
  const documentMetadata = {
    ...resolvedMetadata,
    tags: Array.isArray(resolvedMetadata.tags)
      ? resolvedMetadata.tags
      : toArray(resolvedMetadata.tags)
          .flatMap((item) => String(item).split(/[;,]/))
          .map((item) => normalizeText(item))
          .filter(Boolean),
    source_filename: sourceFilename || null,
    source_path: sourcePath || null,
    source_url: sourceUrl || null,
    checksum,
  };

  const chunks = buildChunkRecords({
    title: resolvedTitle,
    body: resolvedContent,
    summary: resolvedSummary,
    sourcePath,
    sourceUrl,
    sourceFilename,
    districtScope: resolvedDistrictScope,
    taScope: resolvedTaScope,
    departmentScope: resolvedDepartmentScope,
    documentType: resolvedDocumentType,
    metadata: documentMetadata,
    tags: documentMetadata.tags,
  });

  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");
    const documentId = await upsertPlanningDocument(client, {
      sourceKey: finalSourceKey,
      title: resolvedTitle,
      documentType: resolvedDocumentType,
      sourceType,
      sourcePath,
      sourceUrl,
      sourceFilename,
      districtScope: resolvedDistrictScope,
      taScope: resolvedTaScope,
      departmentScope: resolvedDepartmentScope,
      summary: resolvedSummary,
      content: resolvedContent,
      checksum,
      metadata: documentMetadata,
      uploadedByUserId,
    });

    await clearDocumentChunks(client, documentId);
    const chunkCount = await insertPlanningChunks(client, documentId, chunks);
    await client.query("COMMIT");

    return {
      documentId,
      chunkCount,
      title: resolvedTitle,
      checksum,
      sourceKey: finalSourceKey,
      districtScope: resolvedDistrictScope,
      taScope: resolvedTaScope,
      departmentScope: resolvedDepartmentScope,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function ingestPlanningDocumentFile(filePath, options = {}) {
  const resolvedPath = path.resolve(filePath);
  const ext = path.extname(resolvedPath).toLowerCase();

  if (!SUPPORTED_TEXT_EXTENSIONS.has(ext)) {
    throw new Error(`Unsupported planning document file type: ${ext || "unknown"}`);
  }

  const buffer = await fs.readFile(resolvedPath);
  const content = parseDocumentContent(buffer, resolvedPath);

  return ingestPlanningDocument({
    ...options,
    content,
    sourcePath: options.sourcePath || resolvedPath,
    sourceFilename: options.sourceFilename || path.basename(resolvedPath),
    sourceType: options.sourceType || "file",
  });
}

async function walkPlanningDocumentFiles(rootDir) {
  const entries = await fs.readdir(rootDir, { withFileTypes: true });
  const results = [];

  for (const entry of entries) {
    const absolutePath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      const nested = await walkPlanningDocumentFiles(absolutePath);
      results.push(...nested);
      continue;
    }

    if (SUPPORTED_TEXT_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      results.push(absolutePath);
    }
  }

  return results;
}

async function ingestPlanningDocumentsFromDirectory({
  directory,
  sourceType = "etl",
  uploadedByUserId = null,
  defaultMetadata = {},
}) {
  const resolvedDirectory = path.resolve(directory);
  const stats = {
    documents_indexed: 0,
    chunks_indexed: 0,
    skipped: 0,
    documents: [],
  };

  try {
    await fs.access(resolvedDirectory);
  } catch {
    return stats;
  }

  const files = await walkPlanningDocumentFiles(resolvedDirectory);
  for (const filePath of files) {
    try {
      const contentBuffer = await fs.readFile(filePath);
      const parsedContent = parseDocumentContent(contentBuffer, filePath);
      const parsedEnvelope = parseDocumentEnvelope(parsedContent, path.basename(filePath, path.extname(filePath)));
      const result = await ingestPlanningDocument({
        content: parsedContent,
        sourceType,
        sourcePath: path.relative(process.cwd(), filePath).replace(/\\/g, "/"),
        sourceFilename: path.basename(filePath),
        title: parsedEnvelope.title,
        districtScope: parsedEnvelope.districtScope,
        taScope: parsedEnvelope.taScope,
        departmentScope: parsedEnvelope.departmentScope,
        documentType: parsedEnvelope.documentType,
        metadata: {
          ...defaultMetadata,
          ...parsedEnvelope.frontMatter,
          source_kind: sourceType,
        },
        summary: parsedEnvelope.summary,
        uploadedByUserId,
      });

      stats.documents_indexed += 1;
      stats.chunks_indexed += result.chunkCount;
      stats.documents.push({
        document_id: result.documentId,
        source_key: result.sourceKey,
        title: result.title,
        chunk_count: result.chunkCount,
        district_scope: result.districtScope,
        ta_scope: result.taScope,
        department_scope: result.departmentScope,
      });
    } catch (error) {
      stats.skipped += 1;
    }
  }

  return stats;
}

async function getPlanningDocumentById(documentId) {
  await ensurePlanningSchema();
  const result = await db.query(
    `
      SELECT
        pd.id,
        pd.source_key,
        pd.title,
        pd.document_type,
        pd.source_type,
        pd.source_path,
        pd.source_url,
        pd.source_filename,
        pd.district_scope,
        pd.ta_scope,
        pd.department_scope,
        pd.summary,
        pd.content,
        pd.checksum,
        pd.metadata,
        pd.uploaded_by_user_id,
        pd.created_at,
        pd.updated_at,
        COUNT(c.id)::int AS chunk_count
      FROM planning_documents pd
      LEFT JOIN planning_document_chunks c
        ON c.document_id = pd.id
      WHERE pd.id = $1
      GROUP BY pd.id
      LIMIT 1
    `,
    [documentId],
  );

  return result.rows[0] || null;
}

function buildScopeConditions(context = {}) {
  const conditions = [];
  const params = [];

  if (truthyText(context.district)) {
    params.push(normalizeText(context.district));
    conditions.push(
      `(
        pd.district_scope IS NULL
        OR pd.district_scope = ''
        OR LOWER(pd.district_scope) = LOWER($${params.length})
        OR LOWER(pd.district_scope) IN ('all', 'national', 'malawi')
      )`,
    );
  }

  if (truthyText(context.ta)) {
    params.push(normalizeText(context.ta));
    conditions.push(
      `(
        pd.ta_scope IS NULL
        OR pd.ta_scope = ''
        OR LOWER(pd.ta_scope) = LOWER($${params.length})
        OR LOWER(pd.ta_scope) IN ('all', 'national', 'malawi')
      )`,
    );
  }

  return { conditions, params };
}

async function fetchCandidateChunks(context = {}, limit = DEFAULT_CANDIDATE_LIMIT) {
  const scope = buildScopeConditions(context);
  const params = [...scope.params, Math.max(limit, 1)];
  const whereClause = scope.conditions.length
    ? `WHERE ${scope.conditions.join(" AND ")}`
    : "";
  const result = await db.query(
    `
      SELECT
        pd.id AS document_id,
        pd.source_key,
        pd.title,
        pd.document_type,
        pd.source_type,
        pd.source_path,
        pd.source_url,
        pd.source_filename,
        pd.district_scope,
        pd.ta_scope,
        pd.department_scope,
        pd.summary AS document_summary,
        pd.content AS document_content,
        pd.checksum,
        pd.metadata AS document_metadata,
        pd.created_at AS document_created_at,
        pd.updated_at AS document_updated_at,
        c.id AS chunk_id,
        c.chunk_index,
        c.chunk_title,
        c.chunk_text,
        c.chunk_summary,
        c.citation_label,
        c.source_path AS chunk_source_path,
        c.source_url AS chunk_source_url,
        c.page_number,
        c.section_heading,
        c.embedding AS chunk_embedding,
        c.metadata AS chunk_metadata,
        c.created_at AS chunk_created_at,
        c.updated_at AS chunk_updated_at
      FROM planning_document_chunks c
      INNER JOIN planning_documents pd
        ON pd.id = c.document_id
      ${whereClause}
      ORDER BY pd.updated_at DESC, c.chunk_index ASC
      LIMIT $${params.length}
    `,
    params,
  );

  return result.rows;
}

async function fetchVectorCandidates(context = {}, queryVector, limit = 40) {
  const vectorEnabled = await hasVectorSupport();
  if (!vectorEnabled) {
    return [];
  }

  const scope = buildScopeConditions(context);
  const params = [...scope.params, toVectorLiteral(queryVector), Math.max(limit, 1)];
  const whereClause = scope.conditions.length
    ? `AND ${scope.conditions.join(" AND ")}`
    : "";

  const result = await db.query(
    `
      SELECT
        pd.id AS document_id,
        pd.source_key,
        pd.title,
        pd.document_type,
        pd.source_type,
        pd.source_path,
        pd.source_url,
        pd.source_filename,
        pd.district_scope,
        pd.ta_scope,
        pd.department_scope,
        pd.summary AS document_summary,
        pd.content AS document_content,
        pd.checksum,
        pd.metadata AS document_metadata,
        pd.created_at AS document_created_at,
        pd.updated_at AS document_updated_at,
        c.id AS chunk_id,
        c.chunk_index,
        c.chunk_title,
        c.chunk_text,
        c.chunk_summary,
        c.citation_label,
        c.source_path AS chunk_source_path,
        c.source_url AS chunk_source_url,
        c.page_number,
        c.section_heading,
        c.embedding AS chunk_embedding,
        c.embedding_vector,
        c.metadata AS chunk_metadata,
        c.created_at AS chunk_created_at,
        c.updated_at AS chunk_updated_at,
        1 - (c.embedding_vector <=> $${params.length - 1}::vector) AS vector_similarity
      FROM planning_document_chunks c
      INNER JOIN planning_documents pd
        ON pd.id = c.document_id
      WHERE c.embedding_vector IS NOT NULL
      ${whereClause}
      ORDER BY c.embedding_vector <=> $${params.length - 1}::vector
      LIMIT $${params.length}
    `,
    params,
  );

  return result.rows.map((row) => ({
    ...row,
    vector_similarity: Number(row.vector_similarity || 0),
  }));
}

function groupChunksByDocument(rows, context, query, queryVector) {
  const queryTokens = tokenize(query);
  const grouped = new Map();

  rows.forEach((row) => {
    const embedding = Array.isArray(row.chunk_embedding)
      ? row.chunk_embedding
      : typeof row.chunk_embedding === "string"
        ? JSON.parse(row.chunk_embedding)
        : [];
    const similarity = scoreDocumentChunk({
      queryTokens,
      queryVector,
      chunkEmbedding: embedding,
      text: `${row.chunk_title || ""} ${row.chunk_summary || ""} ${row.chunk_text || ""}`,
      doc: row,
      context,
      vectorSimilarity: Number(row.vector_similarity || 0),
    });
    const current = grouped.get(row.document_id);
    const candidate = {
      document_id: row.document_id,
      chunk_id: row.chunk_id,
      title: row.title,
      chunk_title: row.chunk_title,
      source_key: row.source_key,
      source_type: row.source_type,
      source_path: row.source_path,
      source_url: row.source_url,
      source_filename: row.source_filename,
      district_scope: row.district_scope,
      ta_scope: row.ta_scope,
      department_scope: row.department_scope,
      summary: row.document_summary,
      excerpt: summarizeText(row.chunk_text, 2, 360),
      chunk_summary: row.chunk_summary,
      citation_label: row.citation_label || buildSafeCitationTitle(row.title, row.section_heading),
      page_number: row.page_number,
      section_heading: row.section_heading,
      score: similarity,
      relevance: similarity,
      document_created_at: row.document_created_at,
      document_updated_at: row.document_updated_at,
      chunk_metadata: row.chunk_metadata || {},
      document_metadata: row.document_metadata || {},
    };

    if (!current || candidate.score > current.score) {
      grouped.set(row.document_id, candidate);
    }
  });

  return [...grouped.values()]
    .sort((left, right) => right.score - left.score)
    .slice(0, DEFAULT_TOP_K);
}

function formatEvidenceBlock(retrievedDocuments) {
  if (!retrievedDocuments.length) {
    return "No relevant planning documents were retrieved.";
  }

  return retrievedDocuments
    .map((doc, index) => {
      const citationNumber = index + 1;
      return [
        `[${citationNumber}] ${doc.citation_label || doc.title}`,
        doc.summary ? `Document summary: ${doc.summary}` : "",
        doc.excerpt ? `Relevant excerpt: ${doc.excerpt}` : "",
        doc.district_scope ? `District scope: ${doc.district_scope}` : "",
        doc.ta_scope ? `TA scope: ${doc.ta_scope}` : "",
        doc.department_scope ? `Department scope: ${doc.department_scope}` : "",
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n");
}

function buildPrompt(mode, query, context, evidenceBlock) {
  const scopeLines = [
    context.district ? `District: ${context.district}` : null,
    context.ta ? `TA: ${context.ta}` : null,
    context.department ? `Department: ${context.department}` : null,
    context.metricId ? `Metric ID: ${context.metricId}` : null,
    context.metricLabel ? `Metric label: ${context.metricLabel}` : null,
    context.scopeLabel ? `Scope label: ${context.scopeLabel}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  const modeInstructions = {
    query: `
Answer the user's question directly using the evidence.
Return a short answer, 3 actionable bullets, and a short caveat if the evidence is thin.
Use citation numbers inline like [1], [2].
`.trim(),
    recommendations: `
Generate prioritized planning recommendations.
Start with the most actionable intervention first.
Return 3 to 5 bullets and mention why each matters.
Use citation numbers inline like [1], [2].
`.trim(),
    insights: `
Produce a concise metric-specific insight summary.
Explain what the retrieved evidence suggests for this metric and how planners should respond.
Use citation numbers inline like [1], [2].
`.trim(),
    report: `
Write a report-ready analysis section in markdown.
Use headings (## Executive Summary, ## Evidence, ## Recommended Actions, ## Caveats).
Keep the prose analytical and suitable for export into a PDF report.
Use citation numbers inline like [1], [2].
`.trim(),
  };

  return [
    SYSTEM_PROMPT,
    "",
    `Task mode: ${mode}`,
    modeInstructions[mode] || modeInstructions.query,
    "",
    scopeLines ? `Current scope:\n${scopeLines}` : "",
    `User question:\n${normalizeText(query) || "Generate a planning response."}`,
    "",
    `Evidence:\n${evidenceBlock || "No relevant planning documents were retrieved."}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

async function callOpenAIChat({ apiKey, model, messages, temperature, maxTokens, signal }) {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages,
      temperature,
      max_tokens: maxTokens,
    }),
    signal,
  });

  if (!response.ok) {
    throw new Error(`OpenAI chat request failed with status ${response.status}`);
  }

  const payload = await response.json();
  return payload?.choices?.[0]?.message?.content || "";
}

async function callOllamaChat({ baseUrl, model, messages, temperature, signal }) {
  const response = await fetch(`${baseUrl.replace(/\/+$/, "")}/api/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages,
      stream: false,
      options: {
        temperature,
      },
    }),
    signal,
  });

  if (!response.ok) {
    throw new Error(`Ollama chat request failed with status ${response.status}`);
  }

  const payload = await response.json();
  return payload?.message?.content || "";
}

async function callEmbeddingProvider(text) {
  const provider = normalizeKey(process.env.AI_EMBEDDING_PROVIDER || process.env.AI_LLM_PROVIDER || "hash");
  const model = process.env.AI_EMBEDDING_MODEL || process.env.OPENAI_EMBEDDING_MODEL || "text-embedding-3-small";
  const timeoutMs = Math.max(Number(process.env.AI_EMBEDDING_TIMEOUT_MS || 2500), 500);

  if (provider === "openai" && process.env.OPENAI_API_KEY) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch("https://api.openai.com/v1/embeddings", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          input: text,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`OpenAI embedding request failed with status ${response.status}`);
      }

      const payload = await response.json();
      const embedding = payload?.data?.[0]?.embedding;
      if (Array.isArray(embedding) && embedding.length) {
        return embedding;
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  if (provider === "ollama") {
    const baseUrl = process.env.OLLAMA_BASE_URL || "http://localhost:11434";
    const ollamaModel = process.env.OLLAMA_EMBEDDING_MODEL || "nomic-embed-text";
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(`${baseUrl.replace(/\/+$/, "")}/api/embeddings`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: ollamaModel,
          prompt: text,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Ollama embedding request failed with status ${response.status}`);
      }

      const payload = await response.json();
      const embedding = payload?.embedding;
      if (Array.isArray(embedding) && embedding.length) {
        return embedding;
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  return hashEmbedding(text, DEFAULT_EMBEDDING_DIMENSIONS);
}

async function callLlm({ mode, query, context, retrievedDocuments, analysisData = [] }) {
  const provider = normalizeKey(process.env.AI_LLM_PROVIDER || process.env.LLM_PROVIDER || "");
  const model =
    process.env.AI_LLM_MODEL ||
    process.env.OPENAI_LLM_MODEL ||
    process.env.OLLAMA_LLM_MODEL ||
    "gpt-4o-mini";
  const temperature = Number(process.env.AI_LLM_TEMPERATURE || 0.2);
  const maxTokens = Number(process.env.AI_LLM_MAX_TOKENS || 600);
  const timeoutMs = Math.max(Number(process.env.AI_LLM_TIMEOUT_MS || 4000), 1000);
  const evidenceBlock = formatEvidenceBlock(retrievedDocuments);
  const analysisBlock = analysisData.length ? `\n\n## Live Analysis Data\n${analysisData.join("\n")}` : "";
  const prompt = buildPrompt(mode, query, context, evidenceBlock + analysisBlock);

  if (provider === "openai" && process.env.OPENAI_API_KEY) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      return await callOpenAIChat({
        apiKey: process.env.OPENAI_API_KEY,
        model,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: prompt },
        ],
        temperature,
        maxTokens,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  if (provider === "ollama") {
    const baseUrl = process.env.OLLAMA_BASE_URL || "http://localhost:11434";
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      return await callOllamaChat({
        baseUrl,
        model,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: prompt },
        ],
        temperature,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  return "";
}

function buildFallbackAnswer({ mode, query, retrievedDocuments, analysisData = [] }) {
  const evidence = retrievedDocuments.length
    ? retrievedDocuments
        .map((doc, index) => {
          const citation = `[${index + 1}] ${doc.citation_label || doc.title}`;
          const excerpt = doc.excerpt || doc.summary || "No excerpt available";
          return `${citation}: ${excerpt}`;
        })
        .join("\n")
    : "No relevant planning documents were retrieved.";

  const analysisBlock = analysisData.length ? `\n\n## Live Analysis Data\n${analysisData.join("\n")}` : "";

  const bullets = buildFallbackRecommendations(retrievedDocuments, query, mode)
    .split("\n")
    .filter(Boolean);

  return [
    `## ${mode === "report" ? "Report Draft" : "Planning Response"}`,
    normalizeText(query) ? `Question: ${normalizeText(query)}` : "Question: General planning guidance requested.",
    "",
    "## Evidence",
    evidence + analysisBlock,
    "",
    "## Recommended Actions",
    ...bullets.filter((line) => /^\d+\.\s/.test(line) || /^-\s/.test(line)),
  ].join("\n");
}

async function logAiQuery({
  userId,
  queryType,
  queryText,
  context,
  responseText,
  responseJson,
  retrievalCount,
  sourcesCount,
  latencyMs,
  status = "success",
  errorMessage = null,
}) {
  try {
    await ensurePlanningSchema();
    await db.query(
      `
        INSERT INTO ai_query_logs (
          user_id,
          query_type,
          query_text,
          district_name,
          ta_name,
          metric_id,
          metric_label,
          query_context,
          response_text,
          response_json,
          retrieval_count,
          sources_count,
          latency_ms,
          status,
          error_message
        )
        VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10::jsonb, $11, $12, $13, $14, $15
        )
      `,
      [
        userId || null,
        queryType,
        queryText,
        context?.district || null,
        context?.ta || null,
        context?.metricId || null,
        context?.metricLabel || null,
        JSON.stringify(context || {}),
        responseText || null,
        JSON.stringify(responseJson || {}),
        retrievalCount || 0,
        sourcesCount || 0,
        latencyMs || 0,
        status,
        errorMessage || null,
      ],
    );
  } catch (error) {
    // Never fail the user request because audit logging failed.
    void error;
  }
}

function normalizeSources(retrievedDocuments) {
  return retrievedDocuments.map((doc, index) => ({
    id: doc.chunk_id || doc.document_id || index + 1,
    document_id: doc.document_id,
    chunk_id: doc.chunk_id,
    title: doc.title,
    citation_label: doc.citation_label || buildSafeCitationTitle(doc.title, doc.section_heading),
    excerpt: doc.excerpt || doc.chunk_summary || doc.summary || "",
    summary: doc.summary || "",
    source_type: doc.source_type,
    source_path: doc.source_path,
    source_url: doc.source_url,
    source_filename: doc.source_filename,
    district_scope: doc.district_scope,
    ta_scope: doc.ta_scope,
    department_scope: doc.department_scope,
    score: Number(doc.score || 0),
    relevance: Number(doc.relevance || 0),
    link: doc.document_id ? `/api/ai/documents/${doc.document_id}` : null,
    metadata: {
      ...doc.document_metadata,
      ...doc.chunk_metadata,
    },
  }));
}

async function fetchAnalysisData(context) {
  const results = [];
  try {
    const district = context?.district || null;
    const department = context?.department || null;

    let analysisTypes = [];
    if (department) {
      const dept = department.toLowerCase();
      if (dept === "education") analysisTypes = ["education_summary", "nearest_school_distance", "school_service_coverage", "school_population_buffer", "education_welfare_vulnerability", "education_flood_isolation", "school_capacity_risk"];
      else if (dept === "health") analysisTypes = ["health_summary", "nearest_health_distance", "health_service_coverage", "health_population_served", "health_2sfca_access"];
      else if (dept === "welfare") analysisTypes = ["education_welfare_vulnerability", "health_welfare_vulnerability"];
      else if (dept === "disaster") analysisTypes = ["education_flood_isolation", "health_flood_isolation"];
    }

    if (analysisTypes.length) {
      const placeholders = analysisTypes.map((_, i) => `$${i + 1}`).join(",");
      const params = analysisTypes;
      let scopeFilter = "";
      if (district) {
        scopeFilter = ` AND (LOWER(admin_unit_name) LIKE LOWER($${params.length + 1}) OR LOWER(admin_unit_name) LIKE '%' || LOWER($${params.length + 1}) || '%')`;
        params.push(`%${district}%`);
      }
      const arQuery = `
        SELECT analysis_type, admin_unit_type, admin_unit_name, metric_name, metric_value, unit, calculated_at
        FROM analysis_results
        WHERE analysis_type IN (${placeholders})${scopeFilter}
        ORDER BY calculated_at DESC
        LIMIT 80
      `;
      const arResult = await db.query(arQuery, params);
      for (const row of arResult.rows) {
        results.push(`[Analysis] ${row.analysis_type} | ${row.admin_unit_type}: ${row.admin_unit_name} — ${row.metric_name}: ${row.metric_value}${row.unit ? " " + row.unit : ""} (as of ${row.calculated_at ? new Date(row.calculated_at).toISOString().split("T")[0] : "unknown"})`);
      }
    }

    let indicatorTypes = [];
    if (!department || department.toLowerCase() === "education") indicatorTypes.push("school_age_population_total", "child_population_total");
    if (!department || department.toLowerCase() === "health") indicatorTypes.push("population_total", "population_density");
    if (!department) indicatorTypes.push("population_total", "population_density");

    if (indicatorTypes.length) {
      const placeholders = indicatorTypes.map((_, i) => `$${i + 1}`).join(",");
      const params = indicatorTypes;
      let scopeFilter = "";
      if (district) {
        scopeFilter = ` AND (LOWER(geographic_name) LIKE LOWER($${params.length + 1}) OR LOWER(geographic_name) LIKE '%' || LOWER($${params.length + 1}) || '%')`;
        params.push(`%${district}%`);
      }
      const uiQuery = `
        SELECT indicator_name, geographic_level, geographic_name, metric_value, unit, source_date
        FROM unified_indicators
        WHERE indicator_name IN (${placeholders})${scopeFilter}
        ORDER BY source_date DESC
        LIMIT 40
      `;
      const uiResult = await db.query(uiQuery, params);
      for (const row of uiResult.rows) {
        results.push(`[Indicator] ${row.indicator_name} | ${row.geographic_level}: ${row.geographic_name} — ${row.metric_value}${row.unit ? " " + row.unit : ""} (as of ${row.source_date ? new Date(row.source_date).toISOString().split("T")[0] : "unknown"})`);
      }
    }
  } catch (error) {
    void error;
  }
  return results;
}

async function queryRag({
  query,
  mode = "query",
  context = {},
  topK = DEFAULT_TOP_K,
  userId = null,
}) {
  const startedAt = Date.now();
  const normalizedContext = buildDefaultContext({
    ...context,
    query,
  });

  if (isGreeting(query)) {
    const answer = greetingResponse();
    return {
      mode,
      query: normalizeText(query),
      context: normalizedContext,
      answer,
      bullets: [],
      citations: [],
      retrieved_documents: [],
      report_sections: [],
      metadata: {
        retrieval_count: 0,
        sources_count: 0,
        fallback_used: false,
        llm_error: null,
      },
    };
  }

  const augmentedQuery = buildAugmentedQuery(query, normalizedContext);
  const queryVector = await callEmbeddingProvider(augmentedQuery);
  const candidateRows = await fetchCandidateChunks(normalizedContext, DEFAULT_CANDIDATE_LIMIT);
  const vectorRows = await fetchVectorCandidates(normalizedContext, queryVector, Math.max(topK * 8, 24));
  const combinedRows = [...vectorRows, ...candidateRows];

  const rankedSources = groupChunksByDocument(
    combinedRows,
    normalizedContext,
    augmentedQuery,
    queryVector,
  ).slice(0, Math.max(topK, DEFAULT_TOP_K));

  const analysisData = await fetchAnalysisData(normalizedContext);

  let answer = "";
  let llmError = null;
  let fallbackUsed = false;

  try {
    answer = await callLlm({
      mode,
      query: augmentedQuery,
      context: normalizedContext,
      retrievedDocuments: rankedSources,
      analysisData,
    });
  } catch (error) {
    llmError = error;
    fallbackUsed = true;
  }

  if (!normalizeText(answer)) {
    answer = buildFallbackAnswer({
      mode,
      query: augmentedQuery,
      retrievedDocuments: rankedSources,
      analysisData,
    });
    fallbackUsed = true;
  }

  const responsePayload = {
    mode,
    query: normalizeText(query),
    context: normalizedContext,
    answer,
    bullets: answer
      .split(/\r?\n/)
      .map((line) => normalizeText(line))
      .filter((line) => /^[-*]\s+/.test(line) || /^\d+\.\s+/.test(line)),
    citations: normalizeSources(rankedSources),
    retrieved_documents: rankedSources,
    analysis_data: analysisData,
    report_sections: mode === "report" ? markdownSectionsFromText(answer) : [],
    metadata: {
      retrieval_count: candidateRows.length + vectorRows.length,
      sources_count: rankedSources.length,
      analysis_count: analysisData.length,
      fallback_used: fallbackUsed,
      llm_error: llmError ? llmError.message : null,
    },
  };

  await logAiQuery({
    userId,
    queryType: mode,
    queryText: query,
    context: normalizedContext,
    responseText: answer,
    responseJson: responsePayload,
    retrievalCount: candidateRows.length + vectorRows.length,
    sourcesCount: rankedSources.length,
    latencyMs: Date.now() - startedAt,
    status: llmError ? "fallback" : "success",
    errorMessage: llmError ? llmError.message : null,
  });

  return responsePayload;
}

function buildMetricQuestion(metricId, context = {}) {
  const normalizedMetric = normalizeKey(metricId);
  if (normalizedMetric.includes("health")) {
    return "What interventions work best for health access, travel time, and clinic continuity in this area?";
  }

  if (normalizedMetric.includes("education")) {
    return "What interventions work best for school access, learner retention, and education service continuity in this area?";
  }

  if (normalizedMetric.includes("flood") || normalizedMetric.includes("disaster")) {
    return "What flood-risk, evacuation, and service-continuity interventions should be prioritised for this area?";
  }

  if (normalizedMetric.includes("welfare") || normalizedMetric.includes("beneficiary")) {
    return "What targeting, outreach, and cross-sector support interventions work best for welfare planning in this area?";
  }

  return `What planning interventions work best for ${normalizeText(context.scopeLabel) || normalizeText(context.district) || "this area"}?`;
}

function buildRecommendationsQuestion(context = {}) {
  return `What interventions work best for ${normalizeText(context.scopeLabel) || normalizeText(context.ta) || normalizeText(context.district) || "this area"}? Focus on actions that are evidence-based, policy-aware, and feasible in the next planning cycle.`;
}

function buildInsightQuestion(metricId, context = {}) {
  return buildMetricQuestion(metricId, context);
}

function buildReportQuestion(context = {}, outline = null, sectionTitle = null) {
  const outlineText = Array.isArray(outline)
    ? outline.filter(Boolean).map((item) => `- ${item}`).join("\n")
    : normalizeText(outline);

  return [
    sectionTitle ? `Draft a report section titled "${sectionTitle}".` : "Draft an AI-written analysis section for a planning report.",
    context.scopeLabel ? `Scope: ${context.scopeLabel}` : "",
    context.metricLabel ? `Primary metric: ${context.metricLabel}` : "",
    outlineText ? `Outline:\n${outlineText}` : "",
    "Write in a report-friendly style that can be pasted into a PDF export.",
  ]
    .filter(Boolean)
    .join(" ");
}

module.exports = {
  ensurePlanningSchema,
  ingestPlanningDocument,
  ingestPlanningDocumentFile,
  ingestPlanningDocumentsFromDirectory,
  getPlanningDocumentById,
  queryRag,
  buildMetricQuestion,
  buildRecommendationsQuestion,
  buildInsightQuestion,
  buildReportQuestion,
  buildDefaultContext,
  hashEmbedding,
  tokenize,
  summarizeText,
  splitIntoChunks,
  buildSourceKey,
  parseDocumentEnvelope,
  DEFAULT_EMBEDDING_DIMENSIONS,
};
