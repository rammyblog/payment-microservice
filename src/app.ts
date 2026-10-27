import express from "express";
import { errorHandler } from "./middleware/error-handler";
import { PaymentRepository } from "./repositories/payment.repo";
import { createPaymentRouter } from "./routes/payment.routes";
import { PaymentService } from "./services/payment.service";
import { ApiError } from "./utils/errors";
import { logger } from "./utils/logger";

export function createApp(
  service = new PaymentService(new PaymentRepository()),
) {
  const app = express();
  app.disable("x-powered-by");
  app.use((req, res, next) => {
    res.on("finish", () =>
      logger.info("request.finished", {
        method: req.method,
        status: res.statusCode,
      }),
    );
    next();
  });
  app.use(express.json({ limit: "16kb" }));
  app.get("/health", (_req, res) => {
    res
      .status(200)
      .json({ status: "ok", service: "payment-processing-service" });
  });
  app.use("/api/payments", createPaymentRouter(service));
  app.use((_req, _res, next) =>
    next(new ApiError(404, "NOT_FOUND", "Route not found")),
  );
  app.use(errorHandler);
  return app;
}
