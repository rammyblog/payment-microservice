import { randomUUID } from "node:crypto";
import { setTimeout } from "node:timers/promises";
import { PaymentRepository } from "../repositories/payment.repo";
import { Payment, PaymentStatus } from "../types/payment";
import { ApiError } from "../utils/errors";
import { logger } from "../utils/logger";

const transitions: Record<PaymentStatus, readonly PaymentStatus[]> = {
  pending: ["processing"],
  processing: ["completed", "failed"],
  completed: [],
  failed: [],
};

export class PaymentService {
  constructor(
    private readonly repository: PaymentRepository,
    private readonly wait: () => Promise<void> = () => setTimeout(3000),
  ) {}

  createPayment(
    amountMinor: number,
    currency: "NGN",
    idempotencyKey?: string,
  ): Payment {
    if (
      !Number.isSafeInteger(amountMinor) ||
      amountMinor <= 0 ||
      currency !== "NGN"
    ) {
      throw new ApiError(400, "VALIDATION_ERROR", "Invalid payment parameters");
    }
    if (idempotencyKey !== undefined) {
      if (!idempotencyKey.trim() || idempotencyKey.length > 200) {
        throw new ApiError(
          400,
          "VALIDATION_ERROR",
          "Idempotency-Key must contain 1 to 200 characters",
        );
      }
      const existing = this.repository.findByIdempotencyKey(idempotencyKey);
      if (existing) {
        if (
          existing.amountMinor !== amountMinor ||
          existing.currency !== currency
        ) {
          throw new ApiError(
            409,
            "IDEMPOTENCY_CONFLICT",
            "Idempotency-Key was already used with different payment details",
          );
        }
        return existing;
      }
    }
    // Lookup and creation are synchronous, before background processing can yield.
    const now = new Date().toISOString();
    const payment = this.repository.create(
      {
        id: randomUUID(),
        amountMinor,
        currency,
        status: "pending",
        createdAt: now,
        updatedAt: now,
      },
      idempotencyKey,
    );
    void this.processPayment(payment.id).catch(() => {
      logger.error("payment.processing_error", { paymentId: payment.id });
    });
    return payment;
  }

  getPayment(id: string): Payment {
    const payment = this.repository.findById(id);
    if (!payment)
      throw new ApiError(404, "PAYMENT_NOT_FOUND", "Payment not found");
    return payment;
  }

  updateStatus(id: string, status: PaymentStatus): Payment {
    const payment = this.getPayment(id);
    if (!transitions[payment.status].includes(status)) {
      throw new ApiError(
        409,
        "INVALID_TRANSITION",
        "Invalid payment status transition",
      );
    }
    if (status === "processing") {
      void this.processPayment(id).catch(() => {
        logger.error("payment.processing_error", { paymentId: id });
      });
      return this.getPayment(id);
    }
    return this.repository.updateStatus(id, status)!;
  }

  async processPayment(id: string): Promise<void> {
    const payment = this.getPayment(id);
    if (payment.status !== "pending") return;
    // Check and update synchronously before awaiting, so only one attempt starts.
    this.repository.updateStatus(id, "processing");
    logger.info("payment.processing", { paymentId: id });
    let status: "completed" | "failed" = "completed";
    try {
      await this.wait();
    } catch {
      status = "failed";
      logger.error("payment.processing_failed", { paymentId: id });
    }
    // A manual PATCH may have already finished this simulation while we waited.
    if (this.getPayment(id).status === "processing") {
      this.repository.updateStatus(id, status);
      logger.info("payment.finished", { paymentId: id, status });
    }
  }
}
