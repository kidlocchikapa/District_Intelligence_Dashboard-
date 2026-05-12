const express = require("express");
const router = express.Router();
const multer = require("multer");
const { spawn } = require("child_process");
const path = require("path");
const authenticateToken = require("../middleware/auth");

// Multer storage config to save directly where python pipeline expects
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    // Save to the container's sample_data directory
    cb(null, "/app/sample_data/");
  },
  filename: function (req, file, cb) {
    cb(null, Date.now() + "-" + file.originalname);
  },
});
const upload = multer({ storage: storage });

// Upload Endpoint
/**
 * @openapi
 * /api/v1/data/upload:
 *   post:
 *     summary: Upload a dataset and trigger the ETL pipeline
 *     tags:
 *       - Data Manager
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               dataset:
 *                 type: string
 *                 format: binary
 *     responses:
 *       200:
 *         description: Upload accepted
 *       400:
 *         description: No file uploaded
 */
router.post(
  "/upload",
  authenticateToken,
  upload.single("dataset"),
  (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    const uploadedFilename = req.file.filename;

    console.log(
      `[ETL Trigger] Starting pipeline for uploaded file: ${uploadedFilename}`,
    );

    // Spawn the Python ETL process
    // The python script lives in /app/etl/main.py
    const etlProcess = spawn(
      process.env.ETL_PYTHON_PATH || "python3",
      ["/app/etl/main.py", "--files", uploadedFilename],
      {
        // Ensure python executes in /app where pipeline expects sample_data/uploads relative context
        cwd: "/app",
      },
    );

    let etlOutput = "";
    let etlError = "";

    etlProcess.stdout.on("data", (data) => {
      etlOutput += data.toString();
      // Console log for docker
      process.stdout.write(data);
    });

    etlProcess.stderr.on("data", (data) => {
      etlError += data.toString();
      process.stderr.write(data);
    });

    etlProcess.on("close", (code) => {
      console.log(`[ETL Process] Exited with code ${code}`);

      if (code === 0) {
        res.json({
          message: "Dataset uploaded and processed successfully!",
          filename: uploadedFilename,
          logs: etlOutput,
        });
      } else {
        res.status(500).json({
          error: "Pipeline execution failed.",
          details: etlError,
        });
      }
    });
  },
);

module.exports = router;
