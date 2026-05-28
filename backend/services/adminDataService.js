const db = require("../db");

const staleDepartments = {
  education: false,
  health: false,
  welfare: false,
  disaster: false,
};

function getAuthUser(req) {
  return req.user?.user || req.user || {};
}

function parsePositiveInteger(value, fallback = null) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
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

async function writeAuditEntry(
  client,
  {
    tableName,
    recordId,
    action,
    userId,
    beforeData,
    afterData,
    status = "approved",
    requestPayload = null,
    reviewedByUserId = null,
    reviewedAt = null,
    reviewNotes = null,
  },
) {
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
        changed_fields,
        status,
        request_payload,
        reviewed_by_user_id,
        reviewed_at,
        review_notes
      )
      VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb, $8, $9::jsonb, $10, $11, $12)
    `,
    [
      tableName,
      recordId,
      action,
      userId || null,
      JSON.stringify(beforeData ?? null),
      JSON.stringify(afterData ?? null),
      JSON.stringify(changedFields),
      status,
      JSON.stringify(requestPayload ?? null),
      reviewedByUserId || null,
      reviewedAt || null,
      reviewNotes || null,
    ],
  );
}

async function fetchDistrict(client, districtId) {
  if (!districtId) {
    return null;
  }

  const result = await client.query(
    `
      SELECT id, name
      FROM districts
      WHERE id = $1
      LIMIT 1
    `,
    [districtId],
  );

  if (!result.rowCount) {
    throw new Error(`District ${districtId} was not found`);
  }

  return result.rows[0];
}

async function fetchWard(client, wardId) {
  if (!wardId) {
    return null;
  }

  const result = await client.query(
    `
      SELECT id, name, type, district_id
      FROM admin3_units
      WHERE id = $1
      LIMIT 1
    `,
    [wardId],
  );

  if (!result.rowCount) {
    throw new Error(`Administrative unit ${wardId} was not found`);
  }

  return result.rows[0];
}

async function validateDistrictWardRelationship(client, districtId, wardId) {
  const district = districtId ? await fetchDistrict(client, districtId) : null;
  const ward = wardId ? await fetchWard(client, wardId) : null;

  if (
    district &&
    ward &&
    ward.district_id &&
    Number(ward.district_id) !== Number(district.id)
  ) {
    throw new Error("ward_id does not belong to the selected district_id");
  }

  return { district, ward };
}

async function validateWardExists(client, wardId) {
  if (!wardId) {
    return null;
  }

  return fetchWard(client, wardId);
}

function markDepartmentStale(department) {
  if (Object.prototype.hasOwnProperty.call(staleDepartments, department)) {
    staleDepartments[department] = true;
  }
}

function clearDepartmentStale(department) {
  if (Object.prototype.hasOwnProperty.call(staleDepartments, department)) {
    staleDepartments[department] = false;
  }
}

function getStaleDepartments() {
  return { ...staleDepartments };
}

async function withTransaction(handler) {
  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");
    const result = await handler(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  getAuthUser,
  parsePositiveInteger,
  normalizeSortOrder,
  writeAuditEntry,
  validateDistrictWardRelationship,
  validateWardExists,
  markDepartmentStale,
  clearDepartmentStale,
  getStaleDepartments,
  withTransaction,
};
