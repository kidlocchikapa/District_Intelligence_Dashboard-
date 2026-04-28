const Joi = require("joi");

const validationOptions = {
  abortEarly: true,
  stripUnknown: true,
};

const latitudeSchema = Joi.number().min(-90).max(90);
const longitudeSchema = Joi.number().min(-180).max(180);

const educationBaseSchema = {
  name: Joi.string().trim().max(225),
  nameEn: Joi.string().trim().max(225).allow("", null),
  nameNy: Joi.string().trim().max(225).allow("", null),
  amenity: Joi.string().trim().max(100).allow("", null),
  building: Joi.string().trim().max(100).allow("", null),
  operatorType: Joi.string().trim().max(100).allow("", null),
  capacityPersons: Joi.number().integer().min(0).allow(null),
  addressFull: Joi.string().trim().allow("", null),
  addressCity: Joi.string().trim().max(225).allow("", null),
  source: Joi.string().trim().max(225).allow("", null),
  status: Joi.string().trim().max(100).allow("", null),
  comments: Joi.string().trim().allow("", null),
  studentEnrollmentTotal: Joi.number().integer().min(0).allow(null),
  teacherCount: Joi.number().integer().min(0).allow(null),
  districtId: Joi.number().integer().positive().allow(null),
  wardId: Joi.number().integer().positive().allow(null),
  latitude: latitudeSchema.allow(null),
  longitude: longitudeSchema.allow(null),
  isActive: Joi.boolean(),
};

const healthBaseSchema = {
  name: Joi.string().trim().max(255),
  type: Joi.string().trim().max(50).allow("", null),
  healthcare: Joi.string().trim().max(100).allow("", null),
  bedsCount: Joi.number().integer().min(0).allow(null),
  patientVisitsTotal: Joi.number().integer().min(0).allow(null),
  servicesOffered: Joi.alternatives()
    .try(
      Joi.array().items(Joi.string().trim().max(255)).max(100),
      Joi.string().trim().allow(""),
    )
    .allow(null),
  districtId: Joi.number().integer().positive().allow(null),
  wardId: Joi.number().integer().positive().allow(null),
  latitude: latitudeSchema.allow(null),
  longitude: longitudeSchema.allow(null),
  isActive: Joi.boolean(),
};

const welfareBaseSchema = {
  programName: Joi.string().trim().max(100),
  beneficiaryCount: Joi.number().integer().min(0).allow(null),
  wardId: Joi.number().integer().positive().allow(null),
  latitude: latitudeSchema.allow(null),
  longitude: longitudeSchema.allow(null),
  isActive: Joi.boolean(),
};

const disasterBaseSchema = {
  eventType: Joi.string().trim().max(100),
  riskLevel: Joi.string().trim().valid("Low", "Medium", "High", "Critical"),
  populationAtRisk: Joi.number().integer().min(0).allow(null),
  geometryGeoJson: Joi.alternatives()
    .try(Joi.object(), Joi.string())
    .allow(null),
  isActive: Joi.boolean(),
};

const educationCreateSchema = Joi.object({
  ...educationBaseSchema,
  name: educationBaseSchema.name.required().messages({
    "any.required": "name is required",
    "string.empty": "name is required",
  }),
  latitude: latitudeSchema.required().messages({
    "any.required": "latitude is required",
  }),
  longitude: longitudeSchema.required().messages({
    "any.required": "longitude is required",
  }),
});

const healthCreateSchema = Joi.object({
  ...healthBaseSchema,
  name: healthBaseSchema.name.required().messages({
    "any.required": "name is required",
    "string.empty": "name is required",
  }),
  latitude: latitudeSchema.required().messages({
    "any.required": "latitude is required",
  }),
  longitude: longitudeSchema.required().messages({
    "any.required": "longitude is required",
  }),
});

const welfareCreateSchema = Joi.object({
  ...welfareBaseSchema,
  programName: welfareBaseSchema.programName.required().messages({
    "any.required": "programName is required",
    "string.empty": "programName is required",
  }),
  wardId: welfareBaseSchema.wardId.required().messages({
    "any.required": "wardId is required",
  }),
  latitude: latitudeSchema.required().messages({
    "any.required": "latitude is required",
  }),
  longitude: longitudeSchema.required().messages({
    "any.required": "longitude is required",
  }),
});

const disasterCreateSchema = Joi.object({
  ...disasterBaseSchema,
  eventType: disasterBaseSchema.eventType.required().messages({
    "any.required": "eventType is required",
    "string.empty": "eventType is required",
  }),
  riskLevel: disasterBaseSchema.riskLevel.required().messages({
    "any.required": "riskLevel is required",
  }),
  geometryGeoJson: disasterBaseSchema.geometryGeoJson.required().messages({
    "any.required": "geometryGeoJson is required",
  }),
});

const educationUpdateSchema = Joi.object(educationBaseSchema).min(1).messages({
  "object.min": "At least one field is required for update",
});

const healthUpdateSchema = Joi.object(healthBaseSchema).min(1).messages({
  "object.min": "At least one field is required for update",
});

const welfareUpdateSchema = Joi.object(welfareBaseSchema).min(1).messages({
  "object.min": "At least one field is required for update",
});

const disasterUpdateSchema = Joi.object(disasterBaseSchema).min(1).messages({
  "object.min": "At least one field is required for update",
});

function validateWithSchema(schema, payload) {
  const { error, value } = schema.validate(payload, validationOptions);

  return {
    value,
    error: error ? error.details[0].message.replace(/"/g, "") : null,
  };
}

function normalizeServicesOffered(value) {
  if (!Object.prototype.hasOwnProperty.call(value, "servicesOffered")) {
    return value;
  }

  if (Array.isArray(value.servicesOffered)) {
    return value;
  }

  if (value.servicesOffered == null || value.servicesOffered === "") {
    return { ...value, servicesOffered: [] };
  }

  const parsed = String(value.servicesOffered)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  return {
    ...value,
    servicesOffered: parsed,
  };
}

function validateEducationCreate(payload) {
  return validateWithSchema(educationCreateSchema, payload);
}

function validateEducationUpdate(payload) {
  return validateWithSchema(educationUpdateSchema, payload);
}

function validateHealthCreate(payload) {
  const result = validateWithSchema(healthCreateSchema, payload);
  return {
    ...result,
    value: normalizeServicesOffered(result.value || {}),
  };
}

function validateHealthUpdate(payload) {
  const result = validateWithSchema(healthUpdateSchema, payload);
  return {
    ...result,
    value: normalizeServicesOffered(result.value || {}),
  };
}

function validateWelfareCreate(payload) {
  return validateWithSchema(welfareCreateSchema, payload);
}

function validateWelfareUpdate(payload) {
  return validateWithSchema(welfareUpdateSchema, payload);
}

function validateDisasterCreate(payload) {
  return validateWithSchema(disasterCreateSchema, payload);
}

function validateDisasterUpdate(payload) {
  return validateWithSchema(disasterUpdateSchema, payload);
}

const welfareProgramCreateSchema = Joi.object({
  program_name: Joi.string().trim().max(255).required().messages({
    "any.required": "program_name is required",
  }),
  department: Joi.string().trim().max(100).required().messages({
    "any.required": "department is required",
  }),
  description: Joi.string().trim().allow("", null),
});

function validateWelfareProgramCreate(payload) {
  return validateWithSchema(welfareProgramCreateSchema, payload);
}

module.exports = {
  validateEducationCreate,
  validateEducationUpdate,
  validateHealthCreate,
  validateHealthUpdate,
  validateWelfareCreate,
  validateWelfareUpdate,
  validateDisasterCreate,
  validateDisasterUpdate,
  validateWelfareProgramCreate,
};
