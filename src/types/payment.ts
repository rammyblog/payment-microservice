export type PaymentStatus = "pending" | "processing" | "completed" | "failed";

export interface Payment {
  id: string;
  amountMinor: number;
  currency: "NGN";
  status: PaymentStatus;
  createdAt: string;
  updatedAt: string;
}
