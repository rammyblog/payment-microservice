import request from "supertest";
import { createApp } from "../src/app";
import { PaymentRepository } from "../src/repositories/payment.repo";
import { PaymentService } from "../src/services/payment.service";

const payload = { amountMinor: 150000, currency: "NGN" };

function setup() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  const wait = jest.fn(() => promise);
  const repository = new PaymentRepository();
  const service = new PaymentService(repository, wait);
  return { repository, service, wait, resolve, reject, app: createApp(service) };
}

beforeEach(() => {
  jest.spyOn(console, "info").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe("payment service", () => {
  test("creates a pending snapshot and starts processing without waiting", () => {
    const { service, wait } = setup();
    const payment = service.createPayment(150000, "NGN");
    expect(payment).toMatchObject({ ...payload, status: "pending" });
    expect(payment.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(new Date(payment.createdAt).toISOString()).toBe(payment.createdAt);
    expect(service.getPayment(payment.id).status).toBe("processing");
    expect(wait).toHaveBeenCalledTimes(1);
  });

  test("completes after the asynchronous operation finishes", async () => {
    const { service, resolve } = setup();
    const payment = service.createPayment(100, "NGN");
    resolve();
    await Promise.resolve();
    expect(service.getPayment(payment.id).status).toBe("completed");
  });

  test("records a failure when the asynchronous operation rejects", async () => {
    const { service, reject } = setup();
    const payment = service.createPayment(100, "NGN");
    reject(new Error("simulated service error"));
    await Promise.resolve();
    expect(service.getPayment(payment.id).status).toBe("failed");
    expect(console.error).toHaveBeenCalled();
  });

  test("does not start processing twice", async () => {
    const { service, wait } = setup();
    const payment = service.createPayment(100, "NGN");
    await Promise.all([service.processPayment(payment.id), service.processPayment(payment.id)]);
    expect(wait).toHaveBeenCalledTimes(1);
  });

  test.each(["completed", "failed"] as const)("preserves a manual %s update when background work finishes", async (status) => {
    const { service, resolve } = setup();
    const payment = service.createPayment(100, "NGN");
    expect(service.updateStatus(payment.id, status).status).toBe(status);
    resolve();
    await Promise.resolve();
    expect(service.getPayment(payment.id).status).toBe(status);
    expect(() => service.updateStatus(payment.id, "processing")).toThrow("Invalid payment status transition");
  });

  test("rejects backward and repeated transitions", () => {
    const { service } = setup();
    const payment = service.createPayment(100, "NGN");
    expect(() => service.updateStatus(payment.id, "pending")).toThrow();
    expect(() => service.updateStatus(payment.id, "processing")).toThrow();
  });

  test("can manually start a pending payment", () => {
    const { repository, service, wait } = setup();
    const now = new Date().toISOString();
    repository.create({ id: "seed", amountMinor: 1, currency: "NGN", status: "pending", createdAt: now, updatedAt: now });
    expect(service.updateStatus("seed", "processing").status).toBe("processing");
    expect(wait).toHaveBeenCalledTimes(1);
  });

  test("throws 404 for an unknown payment", () => {
    const { service } = setup();
    expect(() => service.getPayment("missing")).toThrow("Payment not found");
    expect(() => service.updateStatus("missing", "failed")).toThrow("Payment not found");
  });

  test("returned snapshots cannot mutate stored payments", () => {
    const { service } = setup();
    const payment = service.createPayment(100, "NGN");
    payment.status = "failed";
    const copy = service.getPayment(payment.id);
    copy.status = "completed";
    expect(service.getPayment(payment.id).status).toBe("processing");
  });
});

describe("payment HTTP API", () => {
  test("POST creates a payment without an idempotency header", async () => {
    const { app } = setup();
    const res = await request(app).post("/api/payments").send(payload);
    expect(res.status).toBe(202);
    expect(res.body).toMatchObject({ ...payload, status: "pending" });
    expect(res.headers.location).toBe(`/api/payments/${res.body.id}`);
  });

  test.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, "100", null])("rejects invalid amount %p", async (amountMinor) => {
    const { app, wait } = setup();
    const res = await request(app).post("/api/payments").send({ ...payload, amountMinor });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    expect(wait).not.toHaveBeenCalled();
  });

  test("rejects invalid currency and missing fields", async () => {
    const { app } = setup();
    for (const body of [{}, { ...payload, currency: "USD" }, { ...payload, extra: true }]) {
      expect((await request(app).post("/api/payments").send(body)).status).toBe(400);
    }
  });

  test("GET retrieves the current payment", async () => {
    const { app, service } = setup();
    const payment = service.createPayment(100, "NGN");
    const res = await request(app).get(`/api/payments/${payment.id}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: payment.id, status: "processing" });
  });

  test("GET and PATCH return 404 for unknown IDs", async () => {
    const { app } = setup();
    expect((await request(app).get("/api/payments/missing")).status).toBe(404);
    expect((await request(app).patch("/api/payments/missing/status").send({ status: "failed" })).status).toBe(404);
  });

  test("PATCH updates status, validates input, and rejects terminal changes", async () => {
    const { app, service } = setup();
    const payment = service.createPayment(100, "NGN");
    const path = `/api/payments/${payment.id}/status`;
    expect((await request(app).patch(path).send({ status: "unknown" })).status).toBe(400);
    const updated = await request(app).patch(path).send({ status: "failed" });
    expect(updated.status).toBe(200);
    expect(updated.body.status).toBe("failed");
    expect((await request(app).patch(path).send({ status: "completed" })).status).toBe(409);
  });

  test("returns health information and consistent parser/route errors", async () => {
    const { app } = setup();
    expect((await request(app).get("/health")).body.status).toBe("ok");
    expect((await request(app).get("/unknown")).status).toBe(404);
    const malformed = await request(app).post("/api/payments").set("Content-Type", "application/json").send('{"invalid":');
    expect(malformed.status).toBe(400);
    expect(malformed.body.error.code).toBe("INVALID_JSON");
    expect((await request(app).post("/api/payments").send({ data: "a".repeat(17000) })).status).toBe(413);
  });

  test("unexpected failures return a generic 500", async () => {
    const { app, repository } = setup();
    jest.spyOn(repository, "findById").mockImplementation(() => { throw new Error("private error"); });
    const res = await request(app).get("/api/payments/id");
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: { code: "INTERNAL_ERROR", message: "Internal server error" } });
  });
});
