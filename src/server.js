import app from "./app.js";
import env from "./config/env.js";

const server = app.listen(env.PORT, () => {
  console.log(`🚀 Swayamsiddha Backend listening on port ${env.PORT} (${env.NODE_ENV})`);
  console.log(`🔗 API Base: http://localhost:${env.PORT}/api`);
  console.log(`🛡️  Allowed Origin: ${env.FRONTEND_ORIGIN}`);
});

// Graceful shutdown handling
process.on("SIGTERM", () => {
  console.log("SIGTERM received, shutting down gracefully...");
  server.close(() => {
    console.log("Server closed.");
    process.exit(0);
  });
});

process.on("SIGINT", () => {
  console.log("SIGINT received, shutting down gracefully...");
  server.close(() => {
    console.log("Server closed.");
    process.exit(0);
  });
});

export default server;
