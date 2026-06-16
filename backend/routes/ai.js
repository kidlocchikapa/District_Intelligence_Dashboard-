const express = require("express");
const fs = require("fs");
const path = require("path");
const multer = require("multer");

const auth = require("../middleware/auth");
const requireGlobalAdmin = require("../middleware/requireGlobalAdmin");
const db = require("../db");
const {
  validateAiQuery,
  validateAiRecommendations,
  validateAiInsights,
  validateAiReport,
  validateDocumentMetadata,
} = require("../validators/aiValidation");
const {
  ensurePlanningSchema,
  ingestPlanningDocument,
  ingestPlanningDocumentFile,
  queryRag,
  buildRecommendationsQuestion,
  buildInsightQuestion,
  buildReportQuestion,
  buildDefaultContext,
  getPlanningDocumentById,
} = require("../services/ragService");

const router = express.Router();
const uploadRoot = path.resolve(__dirname, "../../uploads/planning-documents");
fs.mkdirSync(uploadRoot, { recursive: true });

const storage = multer.diskStorage({
  destination(req, file, cb) {
    cb(null, uploadRoot);
  },
  filename(req, file, cb) {
    const safeName = String(file.originalname || "planning-document")
      .replace(/[^a-zA-Z0-9._-]+/g, "-")
      .replace(/-+/g, "-");
    cb(null, `${Date.now()}-${safeName}`);
  },
});

const upload = multer({ storage });

function parseBodyObject(value) {
  if (!value) {
    return {};
  }

  if (typeof value === "object") {
    return value;
  }

  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return {};
    }
  }

  return {};
}

function normalizeTags(tags) {
  if (!tags) {
    return [];
  }

  if (Array.isArray(tags)) {
    return tags.map((item) => String(item).trim()).filter(Boolean);
  }

  return String(tags)
    .split(/[;,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function buildContextFromBody(body = {}, fallback = {}) {
  const parsedContext = parseBodyObject(body.context);

  return buildDefaultContext({
    ...fallback,
    ...parsedContext,
    district: body.district || parsedContext.district || fallback.district,
    ta: body.ta || parsedContext.ta || fallback.ta,
    metricId: body.metricId || parsedContext.metricId || fallback.metricId,
    metricLabel: body.metricLabel || parsedContext.metricLabel || fallback.metricLabel,
    department: body.department || parsedContext.department || fallback.department,
    scopeLabel: body.scopeLabel || parsedContext.scopeLabel || fallback.scopeLabel,
    sourceHint: body.sourceHint || parsedContext.sourceHint || fallback.sourceHint,
  });
}

async function respondWithAiResult(res, payload) {
  try {
    const result = await queryRag(payload);
    return res.json({
      status: "success",
      data: result,
    });
  } catch (error) {
    console.error("AI query error:", error.message);
    return res.status(500).json({
      status: "error",
      message: "Unable to generate an AI response right now.",
    });
  }
}

/**
 * @openapi
 * /api/ai/query:
 *   post:
 *     summary: Ask a natural language planning question
 *     tags:
 *       - AI
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       200:
 *         description: Retrieved evidence and AI response
 */
router.post("/query", async (req, res) => {
  const { error, value } = validateAiQuery(req.body);
  if (error) {
    return res.status(400).json({ status: "error", message: error });
  }

  const context = buildContextFromBody(value, {
    district: value.context?.district,
    ta: value.context?.ta,
    metricId: value.context?.metricId,
    metricLabel: value.context?.metricLabel,
    department: value.context?.department,
    scopeLabel: value.context?.scopeLabel,
    sourceHint: value.context?.sourceHint,
  });

  return respondWithAiResult(res, {
    query: value.query,
    mode: value.mode || "query",
    topK: value.topK,
    context,
    userId: req.user?.user?.id || req.user?.id || null,
  });
});

/**
 * @openapi
 * /api/ai/recommendations:
 *   post:
 *     summary: Generate planning recommendations from retrieved documents
 *     tags:
 *       - AI
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       200:
 *         description: AI recommendations
 */
router.post("/recommendations", async (req, res) => {
  const { error, value } = validateAiRecommendations(req.body);
  if (error) {
    return res.status(400).json({ status: "error", message: error });
  }

  const context = buildContextFromBody(value, {
    district: value.context?.district,
    ta: value.context?.ta,
    metricId: value.context?.metricId,
    metricLabel: value.context?.metricLabel,
    department: value.context?.department,
    scopeLabel: value.context?.scopeLabel,
  });
  const query = value.query || buildRecommendationsQuestion(context);

  return respondWithAiResult(res, {
    query,
    mode: "recommendations",
    topK: value.topK,
    context,
    userId: req.user?.user?.id || req.user?.id || null,
  });
});

/**
 * @openapi
 * /api/ai/insights/{metricId}:
 *   post:
 *     summary: Generate metric-specific planning insights
 *     tags:
 *       - AI
 *     parameters:
 *       - in: path
 *         name: metricId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Metric insight
 */
router.post("/insights/:metricId", async (req, res) => {
  const payload = {
    ...req.body,
    metricId: req.params.metricId,
  };
  const { error, value } = validateAiInsights(payload);
  if (error) {
    return res.status(400).json({ status: "error", message: error });
  }

  const context = buildContextFromBody(value, {
    district: value.context?.district,
    ta: value.context?.ta,
    metricId: value.metricId,
    metricLabel: value.context?.metricLabel,
    department: value.context?.department,
    scopeLabel: value.context?.scopeLabel,
  });
  const query = value.query || buildInsightQuestion(value.metricId, context);

  return respondWithAiResult(res, {
    query,
    mode: "insights",
    topK: value.topK,
    context,
    userId: req.user?.user?.id || req.user?.id || null,
  });
});

/**
 * @openapi
 * /api/ai/report:
 *   post:
 *     summary: Generate AI-written report sections
 *     tags:
 *       - AI
 *     responses:
 *       200:
 *         description: AI report section draft
 */
router.post("/report", async (req, res) => {
  const { error, value } = validateAiReport(req.body);
  if (error) {
    return res.status(400).json({ status: "error", message: error });
  }

  const context = buildContextFromBody(value, {
    district: value.context?.district,
    ta: value.context?.ta,
    metricId: value.context?.metricId,
    metricLabel: value.context?.metricLabel,
    department: value.context?.department,
    scopeLabel: value.context?.scopeLabel,
  });
  const query = value.query || buildReportQuestion(context, value.outline, value.sectionTitle);

  return respondWithAiResult(res, {
    query,
    mode: "report",
    topK: value.topK,
    context,
    userId: req.user?.user?.id || req.user?.id || null,
  });
});

/**
 * @openapi
 * /api/ai/documents/upload:
 *   post:
 *     summary: Upload and index a planning document
 *     tags:
 *       - AI
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *     responses:
 *       200:
 *         description: Document indexed
 */
router.post(
  "/documents/upload",
  auth,
  requireGlobalAdmin,
  upload.single("file"),
  async (req, res) => {
    try {
      const file = req.file;
      const metadataPayload = parseBodyObject(req.body?.metadata);
      const { error, value } = validateDocumentMetadata({
        ...req.body,
        ...metadataPayload,
        tags: normalizeTags(req.body?.tags || metadataPayload.tags),
      });

      if (error) {
        return res.status(400).json({ status: "error", message: error });
      }

      if (!file && !value.content) {
        return res.status(400).json({
          status: "error",
          message: "Upload a planning document file or provide raw content.",
        });
      }

      const uploadedByUserId = req.user?.user?.id || req.user?.id || null;
      const ingestion = file
        ? await ingestPlanningDocumentFile(file.path, {
            title: value.title || path.basename(file.originalname, path.extname(file.originalname)),
            sourceType: value.sourceType || "upload",
            sourcePath: path.relative(process.cwd(), file.path).replace(/\\/g, "/"),
            sourceUrl: value.sourceUrl || null,
            sourceFilename: file.originalname,
            sourceKey: value.sourceKey || null,
            districtScope: value.districtScope || null,
            taScope: value.taScope || null,
            departmentScope: value.departmentScope || null,
            documentType: value.documentType || "planning_document",
            metadata: {
              ...metadataPayload,
              tags: normalizeTags(value.tags || metadataPayload.tags),
              source_kind: "upload",
              original_filename: file.originalname,
            },
            uploadedByUserId,
          })
        : await ingestPlanningDocument({
            content: value.content,
            title: value.title || "Uploaded planning note",
            sourceType: value.sourceType || "upload",
            sourcePath: value.sourcePath || null,
            sourceUrl: value.sourceUrl || null,
            sourceFilename: value.sourceFilename || null,
            sourceKey: value.sourceKey || null,
            districtScope: value.districtScope || null,
            taScope: value.taScope || null,
            departmentScope: value.departmentScope || null,
            documentType: value.documentType || "planning_document",
            metadata: {
              ...metadataPayload,
              tags: normalizeTags(value.tags || metadataPayload.tags),
              source_kind: "upload",
            },
            summary: value.summary || null,
            uploadedByUserId,
          });

      return res.json({
        status: "success",
        message: "Planning document indexed successfully",
        data: ingestion,
      });
    } catch (error) {
      console.error("Planning document upload error:", error.message);
      return res.status(500).json({
        status: "error",
        message: "Unable to index the uploaded planning document.",
      });
    }
  },
);

/**
 * @openapi
 * /api/ai/documents:
 *   post:
 *     summary: Create or update a planning document from raw content
 *     tags:
 *       - AI
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Document indexed
 */
router.post("/documents", auth, requireGlobalAdmin, async (req, res) => {
  const { error, value } = validateDocumentMetadata(req.body);
  if (error) {
    return res.status(400).json({ status: "error", message: error });
  }

  if (!value.content) {
    return res.status(400).json({
      status: "error",
      message: "Document content is required.",
    });
  }

  try {
    const ingestion = await ingestPlanningDocument({
      content: value.content,
      title: value.title || "Planning Document",
      sourceType: value.sourceType || "manual",
      sourcePath: value.sourcePath || null,
      sourceUrl: value.sourceUrl || null,
      sourceFilename: value.sourceFilename || null,
      sourceKey: value.sourceKey || null,
      districtScope: value.districtScope || null,
      taScope: value.taScope || null,
      departmentScope: value.departmentScope || null,
      documentType: value.documentType || "planning_document",
      metadata: {
        tags: normalizeTags(value.tags),
        source_kind: "manual",
      },
      summary: value.summary || null,
      uploadedByUserId: req.user?.user?.id || req.user?.id || null,
    });

    return res.json({
      status: "success",
      message: "Planning document indexed successfully",
      data: ingestion,
    });
  } catch (error) {
    console.error("Planning document create error:", error.message);
    return res.status(500).json({
      status: "error",
      message: "Unable to index the planning document.",
    });
  }
});

/**
 * @openapi
 * /api/ai/documents/{documentId}:
 *   get:
 *     summary: Fetch a planning document and its indexed chunks
 *     tags:
 *       - AI
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Planning document details
 */
router.get("/documents/:documentId", async (req, res) => {
  const documentId = Number(req.params.documentId);
  if (!Number.isInteger(documentId) || documentId < 1) {
    return res.status(400).json({
      status: "error",
      message: "A valid document id is required.",
    });
  }

  try {
    await ensurePlanningSchema();
    const document = await getPlanningDocumentById(documentId);
    if (!document) {
      return res.status(404).json({
        status: "error",
        message: "Planning document not found.",
      });
    }

    const chunksResult = await db.query(
      `
        SELECT
          id,
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
          metadata,
          created_at,
          updated_at
        FROM planning_document_chunks
        WHERE document_id = $1
        ORDER BY chunk_index ASC
      `,
      [documentId],
    );

    return res.json({
      status: "success",
      data: {
        document,
        chunks: chunksResult.rows,
      },
    });
  } catch (error) {
    console.error("Planning document lookup error:", error.message);
    return res.status(500).json({
      status: "error",
      message: "Unable to load the planning document.",
    });
  }
});

module.exports = router;
