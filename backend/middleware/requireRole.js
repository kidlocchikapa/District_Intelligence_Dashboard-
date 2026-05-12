const { normalizeRole } = require("../services/rbacService");

module.exports = (...roles) => {
  const normalizedRoles = roles.map((role) => normalizeRole(role));

  return (req, res, next) => {
    const authUser = req.user?.user || req.user || {};
    const role = normalizeRole(authUser.role);

    if (!role || !normalizedRoles.includes(role)) {
      return res.status(403).json({
        status: "error",
        message: "You do not have permission to access this resource",
      });
    }

    return next();
  };
};
