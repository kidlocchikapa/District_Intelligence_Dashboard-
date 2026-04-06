const express = require("express");
const fs = require("fs");
const multer = require("multer");
const path = require("path");
const { spawn } = require("child_process");

const auth = require("../middleware/auth");

const router = express.Router();
const uploadDirectory = path.resolve(__dirname, "../../uploads");

fs.mkdirSync(uploadDirectory, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDirectory);
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`);
  },
});

const upload = multer({ storage });

const jobs = new Map();
const recentJobIds = [];
const MAX_RECENT_JOBS = 25;
const MAX_JOB_LOGS = 500;

// Helper function to build ETL arguments based on task type and parameters
const presetTaskDefinitions = {
  worldpop_totals: {
    label: "Refresh district population totals",
    description: "Updates district population totals from WorldPop.",
    stages: ({ apiUrl, worldpopYear, worldpopApiKey }) => [
      {
        label: "WorldPop totals",
        args: buildEtlArgs({
          type: "worldpop",
          sourceType: "worldpop",
          apiUrl,
          worldpopYear,
          worldpopDataset: "wpgppop",
          worldpopApiKey,
        }),
      },
    ],
  },
  worldpop_age_sex: {
    label: "Refresh children and school-age population",
    description:
      "Updates district age-sex population breakdowns for education planning.",
    stages: ({
      apiUrl,
      worldpopYear,
      worldpopApiKey,
      schoolAgeMin,
      schoolAgeMax,
      childClassMax,
    }) => [
      {
        label: "WorldPop age-sex",
        args: buildEtlArgs({
          type: "worldpop",
          sourceType: "worldpop",
          apiUrl,
          worldpopYear,
          worldpopDataset: "wpgpas",
          worldpopApiKey,
          schoolAgeMin,
          schoolAgeMax,
          childClassMax,
        }),
      },
    ],
  },
  education_insights: {
    label: "Recalculate education insights",
    description: "Runs school planning and education access analyses.",
    stages: ({ adminLevel, coverageDistanceKm }) => [
      {
        label: "Education analysis",
        args: buildEtlArgs({
          type: "analysis",
          analysisTypes: [
            "education_summary",
            "nearest_school_distance",
            "school_service_coverage",
          ],
          adminLevel,
          coverageDistanceKm,
        }),
      },
    ],
  },
  health_insights: {
    label: "Recalculate health insights",
    description:
      "Runs facility summary, service coverage, population served, and distance analyses.",
    stages: ({ worldpopYear, adminLevel, coverageDistanceKm }) => [
      {
        label: "Health analysis",
        args: buildEtlArgs({
          type: "analysis",
          worldpopYear,
          analysisTypes: [
            "health_summary",
            "health_population_served",
            "nearest_health_distance",
            "health_service_coverage",
          ],
          adminLevel,
          coverageDistanceKm,
        }),
      },
    ],
  },
  disaster_insights: {
    label: "Recalculate disaster insights",
    description: "Runs district disaster vulnerability analysis.",
    stages: ({ adminLevel }) => [
      {
        label: "Disaster analysis",
        args: buildEtlArgs({
          type: "analysis",
          analysisTypes: ["disaster_vulnerability"],
          adminLevel,
        }),
      },
    ],
  },
  planning_refresh: {
    label: "Run full planning refresh",
    description:
      "Refreshes population inputs first, then recalculates education, health, and disaster insights.",
    stages: ({
      apiUrl,
      worldpopYear,
      worldpopApiKey,
      schoolAgeMin,
      schoolAgeMax,
      childClassMax,
      adminLevel,
      coverageDistanceKm,
    }) => [
      {
        label: "WorldPop totals",
        args: buildEtlArgs({
          type: "worldpop",
          sourceType: "worldpop",
          apiUrl,
          worldpopYear,
          worldpopDataset: "wpgppop",
          worldpopApiKey,
        }),
      },
      {
        label: "WorldPop age-sex",
        args: buildEtlArgs({
          type: "worldpop",
          sourceType: "worldpop",
          apiUrl,
          worldpopYear,
          worldpopDataset: "wpgpas",
          worldpopApiKey,
          schoolAgeMin,
          schoolAgeMax,
          childClassMax,
        }),
      },
      {
        label: "Education analysis",
        args: buildEtlArgs({
          type: "analysis",
          analysisTypes: [
            "education_summary",
            "nearest_school_distance",
            "school_service_coverage",
          ],
          adminLevel,
          coverageDistanceKm,
        }),
      },
      {
        label: "Health analysis",
        args: buildEtlArgs({
          type: "analysis",
          worldpopYear,
          analysisTypes: [
            "health_summary",
            "health_population_served",
            "nearest_health_distance",
            "health_service_coverage",
          ],
          adminLevel,
          coverageDistanceKm,
        }),
      },
      {
        label: "Disaster analysis",
        args: buildEtlArgs({
          type: "analysis",
          analysisTypes: ["disaster_vulnerability"],
          adminLevel,
        }),
      },
    ],
  },
};

// Helper function to construct ETL command-line arguments based on input parameters
function buildEtlArgs({
  type,
  sourceType,
  filePath,
  apiUrl,
  apiHeaders,
  gazetteerPath,
  district,
  missingDataStrategy,
  worldpopYear,
  worldpopDataset,
  worldpopApiKey,
  schoolAgeMin,
  schoolAgeMax,
  childClassMax,
  analysisTypes,
  adminLevel,
  coverageDistanceKm,
}) {
  const args = ["--type", type, "--source-type", sourceType || "file"];

  if (filePath) {
    args.push("--file", filePath);
  }

  if (apiUrl) {
    args.push("--api-url", apiUrl);
  }

  if (gazetteerPath) {
    args.push("--gazetteer", path.resolve(gazetteerPath));
  }

  if (district) {
    args.push("--district", district);
  }

  if (worldpopYear) {
    args.push("--worldpop-year", String(worldpopYear));
  }

  if (worldpopDataset) {
    args.push("--worldpop-dataset", String(worldpopDataset));
  }

  if (worldpopApiKey) {
    args.push("--worldpop-api-key", String(worldpopApiKey));
  }

  if (
    schoolAgeMin !== undefined &&
    schoolAgeMin !== null &&
    schoolAgeMin !== ""
  ) {
    args.push("--school-age-min", String(schoolAgeMin));
  }

  if (
    schoolAgeMax !== undefined &&
    schoolAgeMax !== null &&
    schoolAgeMax !== ""
  ) {
    args.push("--school-age-max", String(schoolAgeMax));
  }

  if (
    childClassMax !== undefined &&
    childClassMax !== null &&
    childClassMax !== ""
  ) {
    args.push("--child-class-max", String(childClassMax));
  }

  if (adminLevel) {
    args.push("--admin-level", adminLevel);
  }

  if (coverageDistanceKm) {
    args.push("--coverage-distance-km", String(coverageDistanceKm));
  }

  if (missingDataStrategy) {
    args.push("--missing-data-strategy", missingDataStrategy);
  }

  if (Array.isArray(analysisTypes)) {
    analysisTypes.forEach((analysisType) => {
      args.push("--analysis-type", analysisType);
    });
  }

  if (apiHeaders && typeof apiHeaders === "object") {
    Object.entries(apiHeaders).forEach(([key, value]) => {
      args.push("--api-header", `${key}=${value}`);
    });
  }

  return args;
}

// Helper function to spawn the ETL process with the correct Python environment
function spawnEtlProcess(args) {
  const scriptPath = path.resolve(__dirname, "../../etl/main.py");
  const configuredPython = process.env.ETL_PYTHON_PATH;
  const localVenvPython = path.resolve(__dirname, "../../etl/venv/bin/python3");
  const pythonBinary =
    configuredPython ||
    (fs.existsSync(localVenvPython) ? localVenvPython : "python3");

  return spawn(pythonBinary, [scriptPath, ...args]);
}

// Job management functions
function createJob({ label, kind, meta = {} }) {
  const jobId = `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const job = {
    id: jobId,
    label,
    kind,
    meta,
    status: "queued",
    createdAt: new Date().toISOString(),
    startedAt: null,
    finishedAt: null,
    logs: [],
  };

  jobs.set(jobId, job);
  recentJobIds.unshift(jobId);
  if (recentJobIds.length > MAX_RECENT_JOBS) {
    const staleJobId = recentJobIds.pop();
    if (staleJobId) {
      jobs.delete(staleJobId);
    }
  }

  appendJobLog(job, "Job created and waiting to start.");
  return job;
};

// Appends a log entry to the job's logs, ensuring we don't exceed the maximum log count
function appendJobLog(job, message, level = "info") {
  const entry = {
    at: new Date().toISOString(),
    level,
    message: String(message).trimEnd(),
  };
  job.logs.push(entry);
  if (job.logs.length > MAX_JOB_LOGS) {
    job.logs.splice(0, job.logs.length - MAX_JOB_LOGS);
  }
}

// Serializes a job object for API responses, including log count and recent logs
function serializeJob(job) {
  return {
    id: job.id,
    label: job.label,
    kind: job.kind,
    meta: job.meta,
    status: job.status,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    logCount: job.logs.length,
    logs: job.logs,
  };
};

// Runs a single stage of the workflow by spawning the ETL process and handling its output and completion
function runProcessForJob(job, args, stageLabel) {
  return new Promise((resolve, reject) => {
    appendJobLog(job, `Starting ${stageLabel}...`);
    const pythonProcess = spawnEtlProcess(args);

    pythonProcess.stdout.on("data", (data) => {
      const message = data.toString();
      message
        .split(/\r?\n/)
        .filter(Boolean)
        .forEach((line) => appendJobLog(job, line, "stdout"));
      console.log(`ETL stdout [${job.id}/${stageLabel}]: ${message}`);
    });

    pythonProcess.stderr.on("data", (data) => {
      const message = data.toString();
      message
        .split(/\r?\n/)
        .filter(Boolean)
        .forEach((line) => appendJobLog(job, line, "stderr"));
      console.error(`ETL stderr [${job.id}/${stageLabel}]: ${message}`);
    });

    pythonProcess.on("error", (error) => {
      appendJobLog(
        job,
        `Unable to start ${stageLabel}: ${error.message}`,
        "error",
      );
      reject(error);
    });

    pythonProcess.on("close", (code) => {
      appendJobLog(
        job,
        `${stageLabel} finished with exit code ${code}.`,
        code === 0 ? "info" : "error",
      );
      console.log(
        `ETL process [${job.id}/${stageLabel}] exited with code ${code}`,
      );

      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`${stageLabel} exited with code ${code}`));
    });
  });
};

// Runs the entire workflow for a job, executing each stage sequentially and updating job status accordingly
async function runWorkflow(job, stages) {
  job.status = "running";
  job.startedAt = new Date().toISOString();

  try {
    for (const stage of stages) {
      await runProcessForJob(job, stage.args, stage.label);
    }
    job.status = "completed";
    appendJobLog(job, "Job completed successfully.");
  } catch (error) {
    job.status = "failed";
    appendJobLog(job, error.message || "Job failed.", "error");
  } finally {
    job.finishedAt = new Date().toISOString();
  }
}

// Queues the workflow to run asynchronously, allowing the API to respond immediately while the job executes in the background
function queueWorkflow(job, stages) {
  setImmediate(() => {
    runWorkflow(job, stages).catch((error) => {
      job.status = "failed";
      job.finishedAt = new Date().toISOString();
      appendJobLog(
        job,
        error.message || "Unexpected workflow failure.",
        "error",
      );
    });
  });
};
