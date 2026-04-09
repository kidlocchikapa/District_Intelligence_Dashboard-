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

const educationUpdateSchema = Joi.object(educationBaseSchema)
  .min(1)
  .messages({
    "object.min": "At least one field is required for update",
  });

function validateWithSchema(schema, payload) {
  const { error, value } = schema.validate(payload, validationOptions);

  return {
    value,
    error: error ? error.details[0].message.replace(/"/g, "") : null,
  };
}

function validateEducationCreate(payload) {
  return validateWithSchema(educationCreateSchema, payload);
}

function validateEducationUpdate(payload) {
  return validateWithSchema(educationUpdateSchema, payload);
}

module.exports = {
  validateEducationCreate,
  validateEducationUpdate,
};
