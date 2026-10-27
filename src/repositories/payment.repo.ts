import { Payment, PaymentStatus } from "../types/payment";

export class PaymentRepository {
  private readonly payments = new Map<string, Payment>();
  private readonly idempotencyKeys = new Map<string, string>();

  create(payment: Payment, idempotencyKey?: string): Payment {
    this.payments.set(payment.id, { ...payment });
    if (idempotencyKey !== undefined)
      this.idempotencyKeys.set(idempotencyKey, payment.id);
    return { ...payment };
  }

  findByIdempotencyKey(key: string): Payment | undefined {
    const id = this.idempotencyKeys.get(key);
    return id === undefined ? undefined : this.findById(id);
  }

  findById(id: string): Payment | undefined {
    const payment = this.payments.get(id);
    return payment ? { ...payment } : undefined;
  }

  updateStatus(id: string, status: PaymentStatus): Payment | undefined {
    const payment = this.payments.get(id);
    if (!payment) return undefined;
    const updated = { ...payment, status, updatedAt: new Date().toISOString() };
    this.payments.set(id, updated);
    return { ...updated };
  }
}
