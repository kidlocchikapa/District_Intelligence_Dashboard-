const {
  userHasDepartmentAccess,
} = require("../services/rbacService");

module.exports = (departmentOrResolver, action = "read") => {
  return async (req, res, next) => {
    try {
      const authUser = req.user?.user || req.user || {};
      const department =
        typeof departmentOrResolver === "function"
          ? departmentOrResolver(req)
          : departmentOrResolver;

      if (!authUser.id) {
        return res.status(401).json({
          status: "error",
          message: "Authentication is required",
        });
      }

      const hasAccess = await userHasDepartmentAccess(
        authUser.id,
        authUser.role,
        department,
        action,
      );

      if (!hasAccess) {
        return res.status(403).json({
          status: "error",
          message: `You do not have ${action} access to the ${department} department`,
        });
      }

      return next();
    } catch (error) {
      console.error("Department access check error:", error.message);
      return res.status(500).json({
        status: "error",
        message: "Unable to verify department access",
      });
    }
  };
};
