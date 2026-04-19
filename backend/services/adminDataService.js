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
  { tableName, recordId, action, userId, beforeData, afterData },
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

async function validateDistrictWardRelationship(client, districtId, wardId) {
  const district = districtId
    ? await fetchAdministrativeUnit(client, districtId, "District")
    : null;
  const ward = wardId
    ? await fetchAdministrativeUnit(client, wardId, "Ward")
    : null;

  if (
    district &&
    ward &&
    ward.parent_id &&
    Number(ward.parent_id) !== Number(district.id)
  ) {
    throw new Error("ward_id does not belong to the selected district_id");
  }

  return { district, ward };
}

async function validateWardExists(client, wardId) {
  if (!wardId) {
    return null;
  }

  return fetchAdministrativeUnit(client, wardId, "Ward");
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
