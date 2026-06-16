const Joi = require("joi");

const baseContextSchema = Joi.object({
  district: Joi.string().trim().max(255).allow("", null),
  ta: Joi.string().trim().max(255).allow("", null),
  metricId: Joi.string().trim().max(150).allow("", null),
  metricLabel: Joi.string().trim().max(255).allow("", null),
  department: Joi.string().trim().max(100).allow("", null),
  scopeLabel: Joi.string().trim().max(255).allow("", null),
  sourceHint: Joi.string().trim().max(255).allow("", null),
});

const querySchema = Joi.object({
  query: Joi.string().trim().min(2).max(4000).required(),
  mode: Joi.string()
    .trim()
    .valid("query", "recommendations", "insights", "report")
    .default("query"),
  topK: Joi.number().integer().min(1).max(10).default(5),
  context: baseContextSchema.default({}),
  includeHistory: Joi.boolean().truthy("true").falsy("false").default(true),
});

const recommendationsSchema = Joi.object({
  query: Joi.string().trim().min(2).max(4000).allow("", null),
  mode: Joi.string().trim().valid("recommendations").default("recommendations"),
  topK: Joi.number().integer().min(1).max(10).default(5),
  context: baseContextSchema.default({}),
  prioritiseEvidence: Joi.boolean().truthy("true").falsy("false").default(true),
});

const insightsSchema = Joi.object({
  metricId: Joi.string().trim().min(1).max(150).required(),
  query: Joi.string().trim().max(4000).allow("", null),
  topK: Joi.number().integer().min(1).max(10).default(5),
  context: baseContextSchema.default({}),
});

const reportSchema = Joi.object({
  query: Joi.string().trim().min(2).max(4000).allow("", null),
  sectionTitle: Joi.string().trim().max(255).allow("", null),
  outline: Joi.alternatives()
    .try(
      Joi.array().items(Joi.string().trim().max(255)).max(10),
      Joi.string().trim().max(4000),
    )
    .allow(null),
  topK: Joi.number().integer().min(1).max(10).default(5),
  context: baseContextSchema.default({}),
});

const documentMetadataSchema = Joi.object({
  title: Joi.string().trim().max(255).allow("", null),
  districtScope: Joi.string().trim().max(255).allow("", null),
  taScope: Joi.string().trim().max(255).allow("", null),
  departmentScope: Joi.string().trim().max(100).allow("", null),
  documentType: Joi.string().trim().max(100).allow("", null),
  sourceType: Joi.string().trim().max(50).allow("", null),
  sourceKey: Joi.string().trim().max(255).allow("", null),
  sourcePath: Joi.string().trim().max(1024).allow("", null),
  sourceUrl: Joi.string().trim().max(1024).allow("", null),
  sourceFilename: Joi.string().trim().max(255).allow("", null),
  tags: Joi.alternatives()
    .try(
      Joi.array().items(Joi.string().trim().max(100)).max(25),
      Joi.string().trim().max(4000),
    )
    .allow("", null),
  content: Joi.string().trim().min(1).max(200000).allow("", null),
  summary: Joi.string().trim().max(10000).allow("", null),
});

function normalizeValidationResult(result) {
  if (!result.error) {
    return {
      error: null,
      value: result.value,
    };
  }

  return {
    error: result.error.details[0]?.message || "Invalid request payload",
    value: result.value,
  };
}

function validateAiQuery(payload) {
  return normalizeValidationResult(querySchema.validate(payload, { abortEarly: true, stripUnknown: true }));
}

function validateAiRecommendations(payload) {
  return normalizeValidationResult(
    recommendationsSchema.validate(payload, { abortEarly: true, stripUnknown: true }),
  );
}

function validateAiInsights(payload) {
  return normalizeValidationResult(
    insightsSchema.validate(payload, { abortEarly: true, stripUnknown: true }),
  );
}

function validateAiReport(payload) {
  return normalizeValidationResult(
    reportSchema.validate(payload, { abortEarly: true, stripUnknown: true }),
  );
}

function validateDocumentMetadata(payload) {
  return normalizeValidationResult(
    documentMetadataSchema.validate(payload, { abortEarly: true, stripUnknown: true }),
  );
}

module.exports = {
  validateAiQuery,
  validateAiRecommendations,
  validateAiInsights,
  validateAiReport,
  validateDocumentMetadata,
  baseContextSchema,
};
