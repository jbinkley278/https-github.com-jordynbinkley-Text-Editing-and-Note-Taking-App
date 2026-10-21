import bcrypt from "bcryptjs";
import { config } from "../config.js";

export async function hashPassword(password) {
  return bcrypt.hash(password, config.bcryptCost);
}

export async function verifyPassword(password, passwordHash) {
  return bcrypt.compare(password, passwordHash);
}
