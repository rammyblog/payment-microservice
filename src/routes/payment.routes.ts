import { Router } from "express";
import { z } from "zod";
import { PaymentService } from "../services/payment.service";

const createPaymentSchema = z
  .object({
    amountMinor: z.int().positive(),
    currency: z.literal("NGN"),
  })
  .strict();
const statusSchema = z
  .object({
    status: z.enum(["pending", "processing", "completed", "failed"]),
  })
  .strict();

export function createPaymentRouter(service: PaymentService): Router {
  const router = Router();

  router.post("/", (req, res) => {
    const body = createPaymentSchema.parse(req.body);
    const payment = service.createPayment(
      body.amountMinor,
      body.currency,
      req.get("Idempotency-Key"),
    );
    res.status(202).location(`/api/payments/${payment.id}`).json(payment);
  });

  router.get("/:id", (req, res) => {
    res.status(200).json(service.getPayment(req.params.id));
  });

  router.patch("/:id/status", (req, res) => {
    const body = statusSchema.parse(req.body);
    res.status(200).json(service.updateStatus(req.params.id, body.status));
  });

  return router;
}
