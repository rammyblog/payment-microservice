import { createApp } from "./app";
import { logger } from "./utils/logger";

const port = Number(process.env.PORT ?? 8900);
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error("Invalid PORT");

createApp().listen(port, () => logger.info("server.started", { port }));
