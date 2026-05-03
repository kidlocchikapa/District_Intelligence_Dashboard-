const path = require("path");
const swaggerJsdoc = require("swagger-jsdoc");

function buildSwaggerSpec({ baseUrl }) {
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
          url: baseUrl,
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
