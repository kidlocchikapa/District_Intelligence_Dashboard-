const { isGlobalAccessRole } = require("../services/rbacService");

function requireGlobalAdmin(req, res, next) {
  const role = req.user?.user?.role || req.user?.role;

  if (isGlobalAccessRole(role)) {
    return next();
  }

  return res.status(403).json({
    status: "error",
    message: "Global admin access is required",
  });
}

module.exports = requireGlobalAdmin;
