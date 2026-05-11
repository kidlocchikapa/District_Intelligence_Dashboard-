const express = require("express");
const cors = require("cors");
const path = require("path");
const swaggerUi = require("swagger-ui-express");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

const { buildSwaggerSpec } = require("./swagger");

const app = express();
const port = process.env.PORT || 5000;
const baseUrl = process.env.API_BASE_URL || `http://localhost:${port}`;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Swagger UI
const swaggerSpec = buildSwaggerSpec({ baseUrl });
app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));
app.get("/api-docs.json", (req, res) => {
  res.setHeader("Content-Type", "application/json");
  res.send(swaggerSpec);
});

// Import Routes
const authRoutes = require("./routes/auth");
const dataManagerRoutes = require("./routes/dataManager");
const dashboardRoutes = require("./routes/dashboard");
const educationRoutes = require("./routes/education");
const healthRoutes = require("./routes/health");
const disasterRoutes = require("./routes/disaster");
const adminRoutes = require("./routes/admin");
const adminDataRoutes = require("./routes/adminData");
const welfareRoutes = require("./routes/welfare");
const exportRoutes = require("./routes/export");

// Register Routes
app.use("/api/v1/auth", authRoutes);
app.use("/api/v1/data", dataManagerRoutes);
app.use("/api/v1/dashboard", dashboardRoutes);
app.use("/api/v1/dashboard/education", educationRoutes);
app.use("/api/v1/dashboard/health", healthRoutes);
app.use("/api/v1/dashboard/disaster", disasterRoutes);
app.use("/api/v1/admin", adminRoutes);
app.use("/api/v1/admin-data", adminDataRoutes);
app.use("/api/v1/export", exportRoutes);
app.use("/api/v1/dashboard/welfare", welfareRoutes);

// Basic Routes
/**
 * @openapi
 * /:
 *   get:
 *     summary: API root message
 *     tags:
 *       - System
 *     responses:
 *       200:
 *         description: API greeting
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 */
app.get(["/", "/api/v1", "/api/v1/"], (req, res) => {
  res.json({ message: "District Intelligence API v1" });
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
