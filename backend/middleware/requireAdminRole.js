module.exports = (req, res, next) => {
  const authUser = req.user?.user || req.user || {};
  const role = authUser.role;

  if (!role || !["admin", "super_admin"].includes(String(role).toLowerCase())) {
    return res.status(403).json({
      status: "error",
      message: "Admin access is required for this action",
    });
  }

  return next();
};
