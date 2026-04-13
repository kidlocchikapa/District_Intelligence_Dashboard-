const db = require("../db");
const ensureRbacSchema = require("../helpers/rbacSchema");

const DEPARTMENTS = ["education", "health", "welfare", "disaster"];
const GLOBAL_ACCESS_ROLES = ["super_admin", "admin"];
const USER_ROLES = ["super_admin", "admin", "department_admin", "analyst", "user"];

function normalizeRole(role) {
  return String(role || "").trim().toLowerCase();
}

function isGlobalAccessRole(role) {
  return GLOBAL_ACCESS_ROLES.includes(normalizeRole(role));
}

function normalizeDepartment(department) {
  return String(department || "").trim().toLowerCase();
}

function hasPermissionForAction(permission, action) {
  if (!permission) {
    return false;
  }

  if (action === "read") {
    return Boolean(permission.can_read || permission.can_write);
  }

  if (action === "write") {
    return Boolean(permission.can_write);
  }

  if (action === "recompute") {
    return Boolean(permission.can_recompute);
  }

  return false;
}

async function fetchUserDepartmentPermissions(userId) {
  if (!userId) {
    return [];
  }

  await ensureRbacSchema();

  const result = await db.query(
    `
      SELECT
        department,
        can_read,
        can_write,
        can_recompute,
        created_at,
        updated_at
      FROM user_department_permissions
      WHERE user_id = $1
      ORDER BY department
    `,
    [userId],
  );

  return result.rows;
}

async function getAccessibleDepartmentsForUser(userId, role, action = "read") {
  if (isGlobalAccessRole(role)) {
    return [...DEPARTMENTS];
  }

  const permissions = await fetchUserDepartmentPermissions(userId);
  return permissions
    .filter((permission) => hasPermissionForAction(permission, action))
    .map((permission) => permission.department);
}

async function userHasDepartmentAccess(userId, role, department, action = "read") {
  const normalizedDepartment = String(department || "").trim().toLowerCase();
  if (!DEPARTMENTS.includes(normalizedDepartment)) {
    return false;
  }

  if (isGlobalAccessRole(role)) {
    return true;
  }

  const permissions = await fetchUserDepartmentPermissions(userId);
  const permission = permissions.find(
    (item) => item.department === normalizedDepartment,
  );

  return hasPermissionForAction(permission, action);
}

function buildAuthAccessProfile(role, permissions) {
  const normalizedRole = normalizeRole(role);
  const accessibleDepartments = isGlobalAccessRole(normalizedRole)
    ? [...DEPARTMENTS]
    : permissions
        .filter((permission) => hasPermissionForAction(permission, "read"))
        .map((permission) => permission.department);

  return {
    role: normalizedRole || null,
    is_global_admin: isGlobalAccessRole(normalizedRole),
    departments: accessibleDepartments,
    permissions,
  };
}

function normalizePermissionList(permissions = []) {
  const uniquePermissions = new Map();

  permissions.forEach((permission) => {
    const department = normalizeDepartment(permission.department);
    if (!DEPARTMENTS.includes(department)) {
      return;
    }

    uniquePermissions.set(department, {
      department,
      can_read: Boolean(permission.canRead ?? permission.can_read),
      can_write: Boolean(permission.canWrite ?? permission.can_write),
      can_recompute: Boolean(permission.canRecompute ?? permission.can_recompute),
    });
  });

  return DEPARTMENTS
    .filter((department) => uniquePermissions.has(department))
    .map((department) => uniquePermissions.get(department));
}

async function replaceUserDepartmentPermissions(queryable, userId, permissions = []) {
  if (!userId) {
    return [];
  }

  await ensureRbacSchema();

  const normalizedPermissions = normalizePermissionList(permissions);

  await queryable.query("DELETE FROM user_department_permissions WHERE user_id = $1", [userId]);

  for (const permission of normalizedPermissions) {
    await queryable.query(
      `
        INSERT INTO user_department_permissions (
          user_id,
          department,
          can_read,
          can_write,
          can_recompute
        )
        VALUES ($1, $2, $3, $4, $5)
      `,
      [
        userId,
        permission.department,
        permission.can_read,
        permission.can_write,
        permission.can_recompute,
      ],
    );
  }

  return normalizedPermissions;
}

module.exports = {
  DEPARTMENTS,
  USER_ROLES,
  normalizeRole,
  normalizeDepartment,
  isGlobalAccessRole,
  fetchUserDepartmentPermissions,
  getAccessibleDepartmentsForUser,
  userHasDepartmentAccess,
  buildAuthAccessProfile,
  normalizePermissionList,
  replaceUserDepartmentPermissions,
};
