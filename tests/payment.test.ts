import request from "supertest";
import { createApp } from "../src/app";
import { PaymentRepository } from "../src/repositories/payment.repo";
import { PaymentService } from "../src/services/payment.service";

const payload = { amountMinor: 150000, currency: "NGN" };

function setup() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  const wait = jest.fn(() => promise);
  const repository = new PaymentRepository();
  const service = new PaymentService(repository, wait);
  return {
    repository,
    service,
    wait,
    resolve,
    reject,
    app: createApp(service),
  };
}

beforeEach(() => {
  jest.spyOn(console, "info").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe("payment repository", () => {
  test("conditionally transitions and rejects stale or invalid transitions", () => {
    const repository = new PaymentRepository();
    const now = new Date().toISOString();
    repository.create({
      id: "seed",
      amountMinor: 1,
      currency: "NGN",
      status: "pending",
      createdAt: now,
      updatedAt: now,
    });
    expect(
      repository.transition("missing", "pending", "processing"),
    ).toBeUndefined();
    expect(
      repository.transition("seed", "pending", "completed"),
    ).toBeUndefined();
    expect(repository.transition("seed", "pending", "processing")?.status).toBe(
      "processing",
    );
    expect(
      repository.transition("seed", "pending", "processing"),
    ).toBeUndefined();
    expect(
      repository.transition("seed", "processing", "completed")?.status,
    ).toBe("completed");
    const completed = repository.findById("seed");
    expect(
      repository.transition("seed", "processing", "failed"),
    ).toBeUndefined();
    expect(
      repository.transition("seed", "completed", "processing"),
    ).toBeUndefined();
    expect(repository.findById("seed")).toEqual(completed);
  });
});

describe("payment service", () => {
  test("reuses a keyed payment during processing and after completion", async () => {
    const { service, wait, resolve } = setup();
    const payment = service.createPayment(100, "NGN", "order-1");
    expect(service.createPayment(100, "NGN", "order-1")).toMatchObject({
      id: payment.id,
      status: "processing",
    });
    resolve();
    await Promise.resolve();
    expect(service.createPayment(100, "NGN", "order-1")).toMatchObject({
      id: payment.id,
      status: "completed",
    });
    expect(wait).toHaveBeenCalledTimes(1);
  });

  test("rejects conflicting key reuse without processing another payment", () => {
    const { service, wait } = setup();
    service.createPayment(100, "NGN", "order-1");
    expect(() => service.createPayment(200, "NGN", "order-1")).toThrow(
      expect.objectContaining({ status: 409, code: "IDEMPOTENCY_CONFLICT" }),
    );
    expect(wait).toHaveBeenCalledTimes(1);
  });

  test("new keys create separate payments", () => {
    const { service, wait } = setup();
    const payments = ["order-1", "order-2"].map((key) =>
      service.createPayment(100, "NGN", key),
    );
    expect(new Set(payments.map((payment) => payment.id)).size).toBe(2);
    expect(wait).toHaveBeenCalledTimes(2);
  });

  test.each(["", "   ", "a".repeat(201)])(
    "rejects an invalid idempotency key",
    (key) => {
      const { service, wait } = setup();
      expect(() => service.createPayment(100, "NGN", key)).toThrow(
        expect.objectContaining({ status: 400 }),
      );
      expect(wait).not.toHaveBeenCalled();
    },
  );

  test("creates a pending snapshot and starts processing without waiting", () => {
    const { service, wait } = setup();
    const payment = service.createPayment(150000, "NGN", "order-1");
    expect(payment).toMatchObject({ ...payload, status: "pending" });
    expect(payment.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(new Date(payment.createdAt).toISOString()).toBe(payment.createdAt);
    expect(service.getPayment(payment.id).status).toBe("processing");
    expect(wait).toHaveBeenCalledTimes(1);
  });

  test("completes after the asynchronous operation finishes", async () => {
    const { service, resolve } = setup();
    const payment = service.createPayment(100, "NGN", "order-1");
    resolve();
    await Promise.resolve();
    expect(service.getPayment(payment.id).status).toBe("completed");
  });

  test("records a failure when the asynchronous operation rejects", async () => {
    const { service, reject } = setup();
    const payment = service.createPayment(100, "NGN", "order-1");
    reject(new Error("simulated service error"));
    await Promise.resolve();
    expect(service.getPayment(payment.id).status).toBe("failed");
    expect(console.error).toHaveBeenCalled();
  });

  test("does not start processing twice", async () => {
    const { service, wait } = setup();
    const payment = service.createPayment(100, "NGN", "order-1");
    await Promise.all([
      service.processPayment(payment.id),
      service.processPayment(payment.id),
    ]);
    expect(wait).toHaveBeenCalledTimes(1);
  });

  test.each(["completed", "failed"] as const)(
    "rejects manual %s outcomes while the processor runs",
    async (status) => {
      const { service, resolve } = setup();
      const payment = service.createPayment(100, "NGN", "order-1");
      expect(() => service.updateStatus(payment.id, status)).toThrow(
        expect.objectContaining({ status: 409 }),
      );
      resolve();
      await Promise.resolve();
      expect(service.getPayment(payment.id).status).toBe("completed");
      expect(() => service.updateStatus(payment.id, "processing")).toThrow(
        "Invalid payment status transition",
      );
    },
  );

  test("rejects backward and repeated transitions", () => {
    const { service } = setup();
    const payment = service.createPayment(100, "NGN", "order-1");
    expect(() => service.updateStatus(payment.id, "pending")).toThrow();
    expect(() => service.updateStatus(payment.id, "processing")).toThrow();
  });

  test("can manually start a pending payment", () => {
    const { repository, service, wait } = setup();
    const now = new Date().toISOString();
    repository.create({
      id: "seed",
      amountMinor: 1,
      currency: "NGN",
      status: "pending",
      createdAt: now,
      updatedAt: now,
    });
    expect(service.updateStatus("seed", "processing").status).toBe(
      "processing",
    );
    expect(wait).toHaveBeenCalledTimes(1);
  });

  test("throws 404 for an unknown payment", () => {
    const { service } = setup();
    expect(() => service.getPayment("missing")).toThrow("Payment not found");
    expect(() => service.updateStatus("missing", "failed")).toThrow(
      "Payment not found",
    );
  });

  test("returned snapshots cannot mutate stored payments", () => {
    const { service } = setup();
    const payment = service.createPayment(100, "NGN", "order-1");
    payment.status = "failed";
    const copy = service.getPayment(payment.id);
    copy.status = "completed";
    expect(service.getPayment(payment.id).status).toBe("processing");
  });
});

describe("payment HTTP API", () => {
  test.each([undefined, "", "a".repeat(201)])(
    "POST rejects missing or invalid keys",
    async (key) => {
      const { app, wait } = setup();
      const req = request(app).post("/api/payments");
      if (key !== undefined) req.set("Idempotency-Key", key);
      const res = await req.send(payload);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
      expect(wait).not.toHaveBeenCalled();
    },
  );

  test("PATCH can start a seeded pending payment", async () => {
    const { app, repository, wait } = setup();
    const now = new Date().toISOString();
    repository.create({
      id: "seed",
      amountMinor: 1,
      currency: "NGN",
      status: "pending",
      createdAt: now,
      updatedAt: now,
    });
    const res = await request(app)
      .patch("/api/payments/seed/status")
      .send({ status: "processing" });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("processing");
    expect(wait).toHaveBeenCalledTimes(1);
  });

  test("matching concurrent retries reuse the payment and changed details conflict", async () => {
    const { app, wait } = setup();
    const responses = await Promise.all(
      [1, 2].map(() =>
        request(app)
          .post("/api/payments")
          .set("Idempotency-Key", "order-1")
          .send(payload),
      ),
    );
    expect(responses.map((res) => res.status)).toEqual([202, 202]);
    expect(responses[0].body.id).toBe(responses[1].body.id);
    expect(responses[0].headers.location).toBe(responses[1].headers.location);
    expect(wait).toHaveBeenCalledTimes(1);
    const conflict = await request(app)
      .post("/api/payments")
      .set("Idempotency-Key", "order-1")
      .send({ ...payload, amountMinor: 200 });
    expect(conflict.status).toBe(409);
    expect(conflict.body.error.code).toBe("IDEMPOTENCY_CONFLICT");
  });

  test("POST creates a payment with an idempotency header", async () => {
    const { app } = setup();
    const res = await request(app)
      .post("/api/payments")
      .set("Idempotency-Key", "order-1")
      .send(payload);
    expect(res.status).toBe(202);
    expect(res.body).toMatchObject({ ...payload, status: "pending" });
    expect(res.headers.location).toBe(`/api/payments/${res.body.id}`);
  });

  test.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, "100", null])(
    "rejects invalid amount %p",
    async (amountMinor) => {
      const { app, wait } = setup();
      const res = await request(app)
        .post("/api/payments")
        .set("Idempotency-Key", "order-1")
        .send({ ...payload, amountMinor });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
      expect(wait).not.toHaveBeenCalled();
    },
  );

  test("rejects invalid currency and missing fields", async () => {
    const { app } = setup();
    for (const body of [
      {},
      { ...payload, currency: "USD" },
      { ...payload, extra: true },
    ]) {
      expect(
        (
          await request(app)
            .post("/api/payments")
            .set("Idempotency-Key", "order-1")
            .send(body)
        ).status,
      ).toBe(400);
    }
  });

  test("GET retrieves the current payment", async () => {
    const { app, service } = setup();
    const payment = service.createPayment(100, "NGN", "order-1");
    const res = await request(app).get(`/api/payments/${payment.id}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: payment.id, status: "processing" });
  });

  test("GET and PATCH return 404 for unknown IDs", async () => {
    const { app } = setup();
    expect((await request(app).get("/api/payments/missing")).status).toBe(404);
    expect(
      (
        await request(app)
          .patch("/api/payments/missing/status")
          .send({ status: "failed" })
      ).status,
    ).toBe(404);
  });

  test("PATCH validates input and cannot override the processor", async () => {
    const { app, service } = setup();
    const payment = service.createPayment(100, "NGN", "order-1");
    const path = `/api/payments/${payment.id}/status`;
    expect(
      (await request(app).patch(path).send({ status: "unknown" })).status,
    ).toBe(400);
    const updated = await request(app).patch(path).send({ status: "failed" });
    expect(updated.status).toBe(409);
    expect(service.getPayment(payment.id).status).toBe("processing");
    expect(
      (await request(app).patch(path).send({ status: "completed" })).status,
    ).toBe(409);
  });

  test("returns health information and consistent parser/route errors", async () => {
    const { app } = setup();
    expect((await request(app).get("/health")).body.status).toBe("ok");
    expect((await request(app).get("/unknown")).status).toBe(404);
    const malformed = await request(app)
      .post("/api/payments")
      .set("Content-Type", "application/json")
      .send('{"invalid":');
    expect(malformed.status).toBe(400);
    expect(malformed.body.error.code).toBe("INVALID_JSON");
    expect(
      (
        await request(app)
          .post("/api/payments")
          .send({ data: "a".repeat(17000) })
      ).status,
    ).toBe(413);
  });

  test("unexpected failures return a generic 500", async () => {
    const { app, repository } = setup();
    jest.spyOn(repository, "findById").mockImplementation(() => {
      throw new Error("private error");
    });
    const res = await request(app).get("/api/payments/id");
    expect(res.status).toBe(500);
    expect(res.body).toEqual({
      error: { code: "INTERNAL_ERROR", message: "Internal server error" },
    });
  });
});
