const express = require("express");
const router = express.Router();
const db = require("../db");
const auth = require("../middlewares/auth");
const {
  validateRegisterUser,
  validateLoginUser,
  validateChangePassword,
} = require("../validators/authValidation");
const {
  signAuthToken,
  hashPassword,
  comparePassword,
} = require("../helpers/authHelpers");

async function ensureUsersTable() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      full_name VARCHAR(255) NOT NULL,
      email VARCHAR(255) NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role VARCHAR(50) NOT NULL DEFAULT 'admin',
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      last_login_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

// @route   POST api/v1/auth/register
// @desc    Register a new user
router.post("/register", async (req, res) => {
  //validating request 
  const { error, value } = validateRegisterUser(req.body);
  if (error) {
    return res.status(400).json({ status: "error", message: error });
  }

  const { fullName, email, password, role } = value;

  try {
    await ensureUsersTable();

    //perform a check if the user email already exists in the database
    const existingUser = await db.query("SELECT id FROM users WHERE email = $1 LIMIT 1", [email]);
    if (existingUser.rowCount > 0) {
      return res.status(409).json({ status: "error", message: "Email already registered" });
    }

    const passwordHash = await hashPassword(password);
    const createdUser = await db.query(
      `
        INSERT INTO users (full_name, email, password_hash, role)
        VALUES ($1, $2, $3, $4)
        RETURNING id, full_name, email, role, created_at
      `,
      [fullName, email, passwordHash, role],
    );

    //generate JWT token for the newly registered user
    const user = createdUser.rows[0];
    const token = signAuthToken({
      id: user.id,
      email: user.email,
      role: user.role,
    });

    //return the token and user info in the response
    return res.status(201).json({
      status: "success",
      data: {
        token,
        user: {
          id: user.id,
          fullName: user.full_name,
          email: user.email,
          role: user.role,
          createdAt: user.created_at,
        },
      },
    });
  } catch (err) {
    console.error("Register error:", err.message);
    return res.status(500).json({ status: "error", message: "Server error" });
  }
});

// @route   POST api/v1/auth/login
// @desc    Authenticate user and return JWT
router.post("/login", async (req, res) => {
  const { error, value } = validateLoginUser(req.body);//validating request
  if (error) {
    return res.status(400).json({ status: "error", message: error });
  }

  const { email, password } = value;

  try {
    await ensureUsersTable();

    const userResult = await db.query(
      `
        SELECT id, full_name, email, password_hash, role, is_active
        FROM users
        WHERE email = $1
        LIMIT 1
      `,
      [email],
    );

    if (userResult.rowCount === 0) {
      return res.status(401).json({ status: "error", message: "Invalid credentials" });
    }

    //check if the user account is active
    const user = userResult.rows[0];
    if (!user.is_active) {
      return res.status(403).json({ status: "error", message: "User account is inactive" });
    }

    //compare the provided password with the stored password hash
    const isPasswordValid = await comparePassword(password, user.password_hash);
    if (!isPasswordValid) {
      return res.status(401).json({ status: "error", message: "Invalid credentials" });
    }

    //generate JWT token for the authenticated user
    const token = signAuthToken(user);

    //update last login timestamp for the user
    await db.query("UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = $1", [user.id]);

    return res.json({
      status: "success",
      data: {
        token,
        user: {
          id: user.id,
          fullName: user.full_name,
          email: user.email,
          role: user.role,
        },
      },
    });
  } catch (err) {
    console.error("Login error:", err.message);
    return res.status(500).json({ status: "error", message: "Server error" });
  }
});


// @route   POST api/v1/auth/change-password
// @desc    Change password for currently authenticated user
router.post("/change-password", auth, async (req, res) => {
  const userId = req.user?.user?.id || req.user?.id;

  if (!userId) {
    return res.status(401).json({ status: "error", message: "Invalid token payload" });
  }

  const { error, value } = validateChangePassword(req.body);
  if (error) {
    return res.status(400).json({ status: "error", message: error });
  }

  const { currentPassword, newPassword } = value;

  try {
    await ensureUsersTable();

    //fetch the user's current password hash from the database
    const result = await db.query("SELECT password_hash FROM users WHERE id = $1 LIMIT 1", [userId]);
    if (result.rowCount === 0) {
      return res.status(404).json({ status: "error", message: "User not found" });
    }

    //compare the provided current password with the stored password hash
    const passwordMatches = await comparePassword(currentPassword, result.rows[0].password_hash);
    if (!passwordMatches) {
      return res.status(401).json({ status: "error", message: "Current password is incorrect" });
    }

    //hash the new password and update it in the database
    const hashedPassword = await hashPassword(newPassword);
     await db.query(
      `
        UPDATE users
        SET password_hash = $1, updated_at = CURRENT_TIMESTAMP
        WHERE id = $2
      `,
      [hashedPassword, userId],
    );

    return res.json({ status: "success", message: "Password updated successfully" });
  } catch (err) {
    console.error("Change password error:", err.message);
    return res.status(500).json({ status: "error", message: "Server error" });
  }
});

module.exports = router;
