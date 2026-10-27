import { Payment, PaymentStatus } from "../types/payment";

export class PaymentRepository {
  private readonly payments = new Map<string, Payment>();

  create(payment: Payment): Payment {
    this.payments.set(payment.id, { ...payment });
    return { ...payment };
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
