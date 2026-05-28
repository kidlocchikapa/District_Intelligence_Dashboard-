const path = require("path");
const swaggerJsdoc = require("swagger-jsdoc");

function normalizeBaseUrl(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

function buildSwaggerSpec({ baseUrl }) {
  const resolvedBaseUrl = normalizeBaseUrl(
    baseUrl ||
      process.env.API_BASE_URL ||
      process.env.BaseUrl ||
      process.env.BASE_URL ||
      "http://localhost:5000",
  );

  const options = {
    definition: {
      openapi: "3.0.0",
      info: {
        title: "District Intelligence API",
        version: "1.0.0",
        description:
          "API documentation for the District Intelligence Dashboard backend.",
      },
      components: {
        securitySchemes: {
          BearerAuth: {
            type: "http",
            scheme: "bearer",
            bearerFormat: "JWT",
          },
        },
      },
      servers: [
        {
          url: resolvedBaseUrl,
          description: "Base URL",
        },
      ],
    },
    apis: [
      path.join(__dirname, "server.js"),
      path.join(__dirname, "routes", "*.js"),
    ],
  };

  return swaggerJsdoc(options);
}

module.exports = { buildSwaggerSpec };
