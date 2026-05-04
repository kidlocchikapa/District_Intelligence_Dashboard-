const Joi = require("joi");

const VALID_ROLES = ["super_admin", "admin", "education_admin", "health_admin", "disaster_admin", "welfare_admin", "department_admin", "analyst", "user"];
const validationOptions = {
  abortEarly: true,
  stripUnknown: true,
};

// Define validation schemas for different authentication operations
const registerSchema = Joi.object({
  fullName: Joi.string().trim().required().messages({
    "any.required": "fullName is required",
    "string.empty": "fullName is required",
  }),
  email: Joi.string().trim().lowercase().email({ tlds: { allow: false } }).required().messages({
    "any.required": "email is required",
    "string.empty": "email is required",
    "string.email": "Invalid email format",
  }),
  password: Joi.string().min(8).required().messages({
    "any.required": "password is required",
    "string.empty": "password is required",
    "string.min": "Password must be at least 8 characters long",
  }),
  role: Joi.string().trim().lowercase().valid(...VALID_ROLES).default("department_admin").messages({
    "any.only": `role must be one of: ${VALID_ROLES.join(", ")}`,
  }),
});

const loginSchema = Joi.object({
  email: Joi.string().trim().lowercase().email({ tlds: { allow: false } }).required().messages({
    "any.required": "Email is required",
    "string.empty": "Email is required",
    "string.email": "Invalid email format",
  }),
  password: Joi.string().required().messages({
    "any.required": "Password is required",
    "string.empty": "Password is required",
  }),
});

const changePasswordSchema = Joi.object({
  currentPassword: Joi.string().required().messages({
    "any.required": "currentPassword is required",
    "string.empty": "currentPassword is required",
  }),
  newPassword: Joi.string().min(8).required().messages({
    "any.required": "newPassword is required",
    "string.empty": "newPassword is required",
    "string.min": "New password must be at least 8 characters long",
  }),
});

function validateWithSchema(schema, payload) {
  const { error, value } = schema.validate(payload, validationOptions);

  return {
    value,
    error: error ? error.details[0].message.replace(/"/g, "") : null,
  };
}

function validateRegisterUser(payload) {
  return validateWithSchema(registerSchema, payload);
}

function validateLoginUser(payload) {
  return validateWithSchema(loginSchema, payload);
}

function validateChangePassword(payload) {
  return validateWithSchema(changePasswordSchema, payload);
}

module.exports = {
  validateRegisterUser,
  validateLoginUser,
  validateChangePassword,
};
