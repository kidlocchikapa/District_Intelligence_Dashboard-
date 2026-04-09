const express = require("express");
const db = require("../db");
const auth = require("../middleware/auth");
const requireAdminRole = require("../middleware/requireAdminRole");
const ensureAdminDataSchema = require("../helpers/adminDataSchema");
const {
  validateEducationCreate,
  validateEducationUpdate,
} = require("../validators/adminDataValidation");

const router = express.Router();

const EDUCATION_SORT_COLUMNS = {
  name: "ef.name",
  status: "ef.status",
  student_enrollment_total: "ef.student_enrollment_total",
  teacher_count: "ef.teacher_count",
  created_at: "ef.created_at",
  updated_at: "ef.updated_at",
};

const EDUCATION_SELECT_FIELDS = `
  ef.school_id,
  ef.name,
  ef."name:en" AS name_en,
  ef."name:ny" AS name_ny,
  ef.amenity,
  ef.building,
  ef."operator:type" AS operator_type,
  ef."capacity:persons" AS capacity_persons,
  ef."addr:full" AS address_full,
  ef."addr:city" AS address_city,
  ef.source,
  ef.status,
  ef.comments,
  ef.student_enrollment,
  ef.student_enrollment_total,
  ef.teacher_distribution,
  ef.teacher_count,
  ef.osm_id,
  ef.osm_type,
  ef.ward_id,
  ward.name AS ward_name,
  ef.district_id,
  district.name AS district_name,
  ef.is_active,
  ef.created_at,
  ef.updated_at,
  ST_Y(ef.geom) AS latitude,
  ST_X(ef.geom) AS longitude
`;

router.use(auth, requireAdminRole);
router.use(async (req, res, next) => {
  try {
    await ensureAdminDataSchema();
    return next();
  } catch (error) {
    console.error("Admin data schema ensure error:", error.message);
    return res.status(500).json({
      status: "error",
      message: "Unable to prepare admin data schema support",
    });
  }
});

function getAuthUser(req) {
  return req.user?.user || req.user || {};
}

function parsePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
}

function normalizeSortColumn(sortBy) {
  return EDUCATION_SORT_COLUMNS[sortBy] || EDUCATION_SORT_COLUMNS.updated_at;
}

function normalizeSortOrder(sortOrder) {
  return String(sortOrder).toLowerCase() === "asc" ? "ASC" : "DESC";
}

function buildChangedFields(beforeData, afterData) {
  const keys = new Set([
    ...Object.keys(beforeData || {}),
    ...Object.keys(afterData || {}),
  ]);

  return [...keys].filter((key) => {
    const beforeValue = beforeData?.[key] ?? null;
    const afterValue = afterData?.[key] ?? null;
    return JSON.stringify(beforeValue) !== JSON.stringify(afterValue);
  });
}

async function writeAuditEntry(client, { tableName, recordId, action, userId, beforeData, afterData }) {
  const changedFields = buildChangedFields(beforeData, afterData);

  await client.query(
    `
      INSERT INTO admin_data_edits (
        table_name,
        record_id,
        action,
        changed_by_user_id,
        before_data,
        after_data,
        changed_fields
      )
      VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb)
    `,
    [
      tableName,
      recordId,
      action,
      userId || null,
      JSON.stringify(beforeData ?? null),
      JSON.stringify(afterData ?? null),
      JSON.stringify(changedFields),
    ],
  );
}

async function fetchAdministrativeUnit(client, unitId, expectedType) {
  if (!unitId) {
    return null;
  }

  const result = await client.query(
    `
      SELECT id, name, type, parent_id
      FROM administrative_units
      WHERE id = $1
      LIMIT 1
    `,
    [unitId],
  );

  if (!result.rowCount) {
    throw new Error(`Administrative unit ${unitId} was not found`);
  }

  const row = result.rows[0];
  if (
    expectedType &&
    row.type &&
    String(row.type).toLowerCase() !== String(expectedType).toLowerCase()
  ) {
    throw new Error(`Administrative unit ${unitId} is not a ${expectedType}`);
  }

  return row;
}

async function validateEducationRelationships(client, districtId, wardId) {
  const district = districtId ? await fetchAdministrativeUnit(client, districtId, "District") : null;
  const ward = wardId ? await fetchAdministrativeUnit(client, wardId, "Ward") : null;

  if (district && ward && ward.parent_id && Number(ward.parent_id) !== Number(district.id)) {
    throw new Error("ward_id does not belong to the selected district_id");
  }

  return { district, ward };
}

async function fetchEducationRecord(client, schoolId) {
  const result = await client.query(
    `
      SELECT
        ${EDUCATION_SELECT_FIELDS}
      FROM education_facilities ef
      LEFT JOIN administrative_units ward ON ward.id = ef.ward_id
      LEFT JOIN administrative_units district ON district.id = ef.district_id
      WHERE ef.school_id = $1
      LIMIT 1
    `,
    [schoolId],
  );

  return result.rows[0] || null;
}

function buildEducationListFilters(query) {
  const conditions = [];
  const params = [];

  if (String(query.include_archived).toLowerCase() !== "true") {
    conditions.push("COALESCE(ef.is_active, TRUE) = TRUE");
  }

  if (query.search && String(query.search).trim()) {
    params.push(`%${String(query.search).trim()}%`);
    conditions.push(`
      (
        COALESCE(ef.name, '') ILIKE $${params.length}
        OR COALESCE(ef."name:en", '') ILIKE $${params.length}
        OR COALESCE(ef."name:ny", '') ILIKE $${params.length}
        OR COALESCE(ef.status, '') ILIKE $${params.length}
      )
    `);
  }

  const districtId = parsePositiveInteger(query.district_id, null);
  if (districtId) {
    params.push(districtId);
    conditions.push(`ef.district_id = $${params.length}`);
  }

  const wardId = parsePositiveInteger(query.ward_id, null);
  if (wardId) {
    params.push(wardId);
    conditions.push(`ef.ward_id = $${params.length}`);
  }

  return {
    whereClause: conditions.length ? `WHERE ${conditions.join(" AND ")}` : "",
    params,
    districtId,
    wardId,
  };
}

function mapEducationPayloadToColumns(payload) {
  const columnMap = [
    ["name", "name"],
    ["nameEn", '"name:en"'],
    ["nameNy", '"name:ny"'],
    ["amenity", "amenity"],
    ["building", "building"],
    ["operatorType", '"operator:type"'],
    ["capacityPersons", '"capacity:persons"'],
    ["addressFull", '"addr:full"'],
    ["addressCity", '"addr:city"'],
    ["source", "source"],
    ["status", "status"],
    ["comments", "comments"],
    ["studentEnrollmentTotal", "student_enrollment_total"],
    ["teacherCount", "teacher_count"],
    ["districtId", "district_id"],
    ["wardId", "ward_id"],
    ["isActive", "is_active"],
  ];

  return columnMap
    .filter(([inputKey]) => Object.prototype.hasOwnProperty.call(payload, inputKey))
    .map(([inputKey, columnName]) => ({
      columnName,
      value: payload[inputKey],
    }));
}

router.get("/education", async (req, res) => {
  try {
    const page = parsePositiveInteger(req.query.page, 1);
    const pageSize = Math.min(parsePositiveInteger(req.query.page_size, 25), 100);
    const offset = (page - 1) * pageSize;
    const { whereClause, params, districtId, wardId } = buildEducationListFilters(req.query);
    const orderBy = normalizeSortColumn(req.query.sort_by);
    const orderDirection = normalizeSortOrder(req.query.sort_order);

    const countResult = await db.query(
      `
        SELECT COUNT(*)::int AS total
        FROM education_facilities ef
        ${whereClause}
      `,
      params,
    );

    const dataParams = [...params, pageSize, offset];
    const rowsResult = await db.query(
      `
        SELECT
          ${EDUCATION_SELECT_FIELDS}
        FROM education_facilities ef
        LEFT JOIN administrative_units ward ON ward.id = ef.ward_id
        LEFT JOIN administrative_units district ON district.id = ef.district_id
        ${whereClause}
        ORDER BY ${orderBy} ${orderDirection}, ef.school_id DESC
        LIMIT $${dataParams.length - 1}
        OFFSET $${dataParams.length}
      `,
      dataParams,
    );

    const total = countResult.rows[0]?.total || 0;

    return res.json({
      status: "success",
      data: {
        items: rowsResult.rows,
        page,
        page_size: pageSize,
        total,
        total_pages: total ? Math.ceil(total / pageSize) : 0,
        filters: {
          search: req.query.search || "",
          district_id: districtId,
          ward_id: wardId,
          include_archived: String(req.query.include_archived).toLowerCase() === "true",
        },
      },
    });
  } catch (error) {
    console.error("Admin education list error:", error.message);
    return res.status(500).json({
      status: "error",
      message: "Unable to load education records",
    });
  }
});

router.get("/education/:id", async (req, res) => {
  try {
    const schoolId = parsePositiveInteger(req.params.id, null);
    if (!schoolId) {
      return res.status(400).json({
        status: "error",
        message: "A valid school id is required",
      });
    }

    const record = await fetchEducationRecord(db, schoolId);
    if (!record) {
      return res.status(404).json({
        status: "error",
        message: "Education record not found",
      });
    }

    return res.json({
      status: "success",
      data: {
        record,
      },
    });
  } catch (error) {
    console.error("Admin education detail error:", error.message);
    return res.status(500).json({
      status: "error",
      message: "Unable to load the education record",
    });
  }
});

router.get("/education/:id/history", async (req, res) => {
  try {
    const schoolId = parsePositiveInteger(req.params.id, null);
    if (!schoolId) {
      return res.status(400).json({
        status: "error",
        message: "A valid school id is required",
      });
    }

    const result = await db.query(
      `
        SELECT
          ade.id,
          ade.table_name,
          ade.record_id,
          ade.action,
          ade.changed_by_user_id,
          ade.before_data,
          ade.after_data,
          ade.changed_fields,
          ade.changed_at,
          u.email AS changed_by_email,
          u.full_name AS changed_by_full_name
        FROM admin_data_edits ade
        LEFT JOIN users u ON u.id = ade.changed_by_user_id
        WHERE ade.table_name = 'education_facilities'
          AND ade.record_id = $1
        ORDER BY ade.changed_at DESC, ade.id DESC
      `,
      [schoolId],
    );

    return res.json({
      status: "success",
      data: {
        items: result.rows,
      },
    });
  } catch (error) {
    console.error("Admin education history error:", error.message);
    return res.status(500).json({
      status: "error",
      message: "Unable to load education record history",
    });
  }
});

router.post("/education", async (req, res) => {
  const { error, value } = validateEducationCreate(req.body);
  if (error) {
    return res.status(400).json({
      status: "error",
      message: error,
    });
  }

  const client = await db.pool.connect();

  try {
    await client.query("BEGIN");
    await validateEducationRelationships(client, value.districtId, value.wardId);

    const authUser = getAuthUser(req);
    const insertedResult = await client.query(
      `
        INSERT INTO education_facilities (
          name,
          "name:en",
          "name:ny",
          amenity,
          building,
          "operator:type",
          "capacity:persons",
          "addr:full",
          "addr:city",
          source,
          status,
          comments,
          student_enrollment_total,
          teacher_count,
          district_id,
          ward_id,
          geom,
          is_active,
          updated_at
        )
        VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
          $11, $12, $13, $14, $15, $16,
          ST_SetSRID(ST_MakePoint($17, $18), 4326),
          COALESCE($19, TRUE),
          CURRENT_TIMESTAMP
        )
        RETURNING school_id
      `,
      [
        value.name,
        value.nameEn ?? null,
        value.nameNy ?? null,
        value.amenity ?? null,
        value.building ?? null,
        value.operatorType ?? null,
        value.capacityPersons ?? null,
        value.addressFull ?? null,
        value.addressCity ?? null,
        value.source ?? null,
        value.status ?? null,
        value.comments ?? null,
        value.studentEnrollmentTotal ?? null,
        value.teacherCount ?? null,
        value.districtId ?? null,
        value.wardId ?? null,
        value.longitude,
        value.latitude,
        value.isActive,
      ],
    );

    const schoolId = insertedResult.rows[0].school_id;
    const createdRecord = await fetchEducationRecord(client, schoolId);

    await writeAuditEntry(client, {
      tableName: "education_facilities",
      recordId: schoolId,
      action: "create",
      userId: authUser.id,
      beforeData: null,
      afterData: createdRecord,
    });

    await client.query("COMMIT");

    return res.status(201).json({
      status: "success",
      message: "Education record created successfully",
      data: {
        record: createdRecord,
      },
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Admin education create error:", error.message);
    return res.status(400).json({
      status: "error",
      message: error.message || "Unable to create education record",
    });
  } finally {
    client.release();
  }
});

router.patch("/education/:id", async (req, res) => {
  const schoolId = parsePositiveInteger(req.params.id, null);
  if (!schoolId) {
    return res.status(400).json({
      status: "error",
      message: "A valid school id is required",
    });
  }

  const { error, value } = validateEducationUpdate(req.body);
  if (error) {
    return res.status(400).json({
      status: "error",
      message: error,
    });
  }

  if (
    (Object.prototype.hasOwnProperty.call(value, "latitude") &&
      !Object.prototype.hasOwnProperty.call(value, "longitude")) ||
    (!Object.prototype.hasOwnProperty.call(value, "latitude") &&
      Object.prototype.hasOwnProperty.call(value, "longitude"))
  ) {
    return res.status(400).json({
      status: "error",
      message: "latitude and longitude must be provided together",
    });
  }

  const pendingUpdates = mapEducationPayloadToColumns(value);
  const includesGeometryUpdate = Object.prototype.hasOwnProperty.call(value, "latitude");
  if (!pendingUpdates.length && !includesGeometryUpdate) {
    return res.status(400).json({
      status: "error",
      message: "No editable fields were provided",
    });
  }

  const client = await db.pool.connect();

  try {
    await client.query("BEGIN");

    const existingRecord = await fetchEducationRecord(client, schoolId);
    if (!existingRecord) {
      await client.query("ROLLBACK");
      return res.status(404).json({
        status: "error",
        message: "Education record not found",
      });
    }

    const nextDistrictId = Object.prototype.hasOwnProperty.call(value, "districtId")
      ? value.districtId
      : existingRecord.district_id;
    const nextWardId = Object.prototype.hasOwnProperty.call(value, "wardId")
      ? value.wardId
      : existingRecord.ward_id;
    await validateEducationRelationships(client, nextDistrictId, nextWardId);

    const setClauses = [];
    const params = [];

    pendingUpdates.forEach(({ columnName, value: columnValue }) => {
      params.push(columnValue ?? null);
      setClauses.push(`${columnName} = $${params.length}`);
    });

    if (includesGeometryUpdate) {
      params.push(value.longitude, value.latitude);
      setClauses.push(`geom = ST_SetSRID(ST_MakePoint($${params.length - 1}, $${params.length}), 4326)`);
    }

    setClauses.push("updated_at = CURRENT_TIMESTAMP");
    params.push(schoolId);

    await client.query(
      `
        UPDATE education_facilities
        SET ${setClauses.join(", ")}
        WHERE school_id = $${params.length}
      `,
      params,
    );

    const updatedRecord = await fetchEducationRecord(client, schoolId);
    const authUser = getAuthUser(req);

    await writeAuditEntry(client, {
      tableName: "education_facilities",
      recordId: schoolId,
      action: "update",
      userId: authUser.id,
      beforeData: existingRecord,
      afterData: updatedRecord,
    });

    await client.query("COMMIT");

    return res.json({
      status: "success",
      message: "Education record updated successfully",
      data: {
        record: updatedRecord,
      },
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Admin education update error:", error.message);
    return res.status(400).json({
      status: "error",
      message: error.message || "Unable to update education record",
    });
  } finally {
    client.release();
  }
});

router.post("/education/:id/archive", async (req, res) => {
  const schoolId = parsePositiveInteger(req.params.id, null);
  if (!schoolId) {
    return res.status(400).json({
      status: "error",
      message: "A valid school id is required",
    });
  }

  const client = await db.pool.connect();

  try {
    await client.query("BEGIN");
    const existingRecord = await fetchEducationRecord(client, schoolId);
    if (!existingRecord) {
      await client.query("ROLLBACK");
      return res.status(404).json({
        status: "error",
        message: "Education record not found",
      });
    }

    await client.query(
      `
        UPDATE education_facilities
        SET is_active = FALSE,
            updated_at = CURRENT_TIMESTAMP
        WHERE school_id = $1
      `,
      [schoolId],
    );

    const archivedRecord = await fetchEducationRecord(client, schoolId);
    const authUser = getAuthUser(req);

    await writeAuditEntry(client, {
      tableName: "education_facilities",
      recordId: schoolId,
      action: "archive",
      userId: authUser.id,
      beforeData: existingRecord,
      afterData: archivedRecord,
    });

    await client.query("COMMIT");

    return res.json({
      status: "success",
      message: "Education record archived successfully",
      data: {
        record: archivedRecord,
      },
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Admin education archive error:", error.message);
    return res.status(400).json({
      status: "error",
      message: error.message || "Unable to archive education record",
    });
  } finally {
    client.release();
  }
});

module.exports = router;
