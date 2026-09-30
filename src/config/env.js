import "dotenv/config";

export const env = {
  NODE_ENV: process.env.NODE_ENV || "development",
  PORT: parseInt(process.env.PORT || "5000", 10),
  DATABASE_URL: process.env.DATABASE_URL || "postgresql://postgres:postgres@localhost:5432/swayamsiddha_dev?schema=public",
  SESSION_SECRET: process.env.SESSION_SECRET || "swayamsiddha_dev_session_secret_replace_in_prod",
  SESSION_COOKIE_NAME: process.env.SESSION_COOKIE_NAME || "swayamsiddha_session",
  SESSION_MAX_AGE_DAYS: parseInt(process.env.SESSION_MAX_AGE_DAYS || "7", 10),
  FRONTEND_ORIGIN: process.env.FRONTEND_ORIGIN || "http://localhost:5173",
};

export default env;
