const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");

const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "1d";
const parsedBcryptRounds = Number(process.env.BCRYPT_ROUNDS);
const BCRYPT_ROUNDS =
  Number.isInteger(parsedBcryptRounds) && parsedBcryptRounds >= 10 ? parsedBcryptRounds : 12;

function signAuthToken(user) {
  if (!process.env.JWT_SECRET) {
    throw new Error("JWT_SECRET is not configured.");
  }

  const payload = {
    user: {
      id: user.id,
      email: user.email,
      role: user.role,
    },
  };

  return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

async function hashPassword(password) {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

async function comparePassword(password, passwordHash) {
  return bcrypt.compare(password, passwordHash);
}

module.exports = {
  signAuthToken,
  hashPassword,
  comparePassword,
};
