const Joi = require("joi");
const { DEPARTMENTS, USER_ROLES } = require("../services/rbacService");

const validationOptions = {
  abortEarly: true,
  stripUnknown: true,
};

const userUpdateSchema = Joi.object({
  role: Joi.string().trim().lowercase().valid(...USER_ROLES),
  isActive: Joi.boolean(),
}).min(1).messages({
  "object.min": "At least one user field is required",
});

const departmentPermissionSchema = Joi.object({
  department: Joi.string().trim().lowercase().valid(...DEPARTMENTS).required(),
  canRead: Joi.boolean().default(true),
  canWrite: Joi.boolean().default(false),
  canRecompute: Joi.boolean().default(false),
});

const replaceDepartmentPermissionsSchema = Joi.object({
  permissions: Joi.array()
    .items(departmentPermissionSchema)
    .max(DEPARTMENTS.length)
    .required()
    .messages({
      "any.required": "permissions is required",
      "array.max": `permissions cannot contain more than ${DEPARTMENTS.length} departments`,
    }),
});

function validateWithSchema(schema, payload) {
  const { error, value } = schema.validate(payload, validationOptions);

  return {
    value,
    error: error ? error.details[0].message.replace(/"/g, "") : null,
  };
}

function validateAdminUserUpdate(payload) {
  return validateWithSchema(userUpdateSchema, payload);
}

function validateReplaceDepartmentPermissions(payload) {
  return validateWithSchema(replaceDepartmentPermissionsSchema, payload);
}

module.exports = {
  validateAdminUserUpdate,
  validateReplaceDepartmentPermissions,
};
