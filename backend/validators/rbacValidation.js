const Joi = require("joi");
const { DEPARTMENTS, USER_ROLES } = require("../services/rbacService");

const validationOptions = {
  abortEarly: true,
  stripUnknown: true,
};

const userUpdateSchema = Joi.object({
  fullName: Joi.string().trim().min(1),
  username: Joi.string().trim().min(1),
  email: Joi.string()
    .trim()
    .lowercase()
    .email({ tlds: { allow: false } }),
  role: Joi.string()
    .trim()
    .lowercase()
    .valid(...USER_ROLES),
  isActive: Joi.boolean(),
})
  .min(1)
  .messages({
    "object.min": "At least one user field is required",
  });

const userCreateSchema = Joi.object({
  fullName: Joi.string().trim().required(),
  email: Joi.string().email().trim().required(),
  password: Joi.string().min(8).required(),
  role: Joi.string()
    .trim()
    .lowercase()
    .valid(...USER_ROLES)
    .default("user"),
});

const departmentPermissionSchema = Joi.object({
  department: Joi.string()
    .trim()
    .lowercase()
    .valid(...DEPARTMENTS)
    .required(),
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

function validateAdminUserCreate(payload) {
  return validateWithSchema(userCreateSchema, payload);
}

module.exports = {
  validateAdminUserCreate,
  validateAdminUserUpdate,
  validateReplaceDepartmentPermissions,
};
