# Payment Processing Simulation

A small Node.js and TypeScript service using Express, Zod, in-memory Map storage, and Jest/Supertest. It demonstrates REST endpoints, asynchronous work, error handling, and structured console logging. No real money is processed.

## Run locally

Use Node.js 22 or later and npm:

```sh
npm ci
npm run dev
```

The service runs at `http://localhost:8900`. Set `PORT` to change the port:

```sh
PORT=9000 npm run dev
```

`.env.example` documents configuration. Environment files are not loaded automatically.

For a production build:

```sh
npm run build
npm start
```

## API

| Method | Path | Behavior |
| --- | --- | --- |
| POST | `/api/payments` | Create a payment; return `202` and a `Location` header |
| GET | `/api/payments/:id` | Return the payment and current status |
| PATCH | `/api/payments/:id/status` | Manually update a simulated payment's status |
| GET | `/health` | Return service health |

Create a payment:

```sh
curl -i -X POST http://localhost:8900/api/payments \
  -H 'Content-Type: application/json' \
  -d '{"amountMinor":150000,"currency":"NGN"}'
```

`amountMinor` must be a positive safe integer in kobo; `150000` represents NGN 1,500. `currency` must be `NGN`. Unknown body fields are rejected. Each POST creates a new payment; no idempotency header is required or implemented.

The response contains `id`, `amountMinor`, `currency`, `status`, `createdAt`, and `updatedAt`. IDs use Node's `crypto.randomUUID()` and timestamps are ISO strings. The POST response contains the initial pending snapshot; processing starts immediately in the background.

Retrieve a payment using the ID returned by POST:

```sh
curl http://localhost:8900/api/payments/<id>
```

Manually simulate failure while a payment is processing:

```sh
curl -i -X PATCH http://localhost:8900/api/payments/<id>/status \
  -H 'Content-Type: application/json' \
  -d '{"status":"failed"}'
```

Check service health:

```sh
curl http://localhost:8900/health
```

## Processing and status updates

```text
pending → processing → completed
                     ↘ failed
```

Processing awaits a three-second timer and then completes. There is no random success probability. An exception during the asynchronous operation marks the payment failed and is logged. Tests inject a controlled wait function to demonstrate success and failure without real delays.

PATCH follows the same lifecycle: pending can become processing; processing can become completed or failed. Repeated, backward, and terminal-state changes return `409`. The background task checks the current status after waiting, so a manual completion or failure is preserved. These checks and writes happen synchronously, preventing duplicate processing attempts in this single process.

PATCH is part of this simulation and has no authentication. In normal use, POST has already started processing, so manually setting `processing` will return `409`.

## Errors and logging

Errors share a consistent JSON shape:

```json
{"error":{"code":"PAYMENT_NOT_FOUND","message":"Payment not found"}}
```

- `400`: invalid input or malformed JSON.
- `404`: unknown payment or route.
- `409`: invalid status transition.
- `413`: JSON body exceeds 16 KiB.
- `500`: unexpected service error, with a generic public message.

Requests and processing events are logged as JSON through `console.info` and `console.error`. Error responses do not expose internal exception details.

## Code structure

```text
src/
├── app.ts                         # Express setup
├── server.ts                      # Listener and port configuration
├── types/payment.ts               # Payment model
├── repositories/payment.repo.ts    # Map storage
├── services/payment.service.ts     # Lifecycle and async simulation
├── routes/payment.routes.ts        # Validation and endpoints
├── middleware/error-handler.ts     # Central error responses
└── utils/
    ├── errors.ts                  # HTTP application error
    └── logger.ts                  # JSON console logging
tests/
└── payment.test.ts                 # Service and HTTP tests
```

Routes validate input, the service handles payment behavior, and the repository stores records. The app accepts a service instance for testing. The service accepts a repository and a wait function; no provider framework is needed. Repository methods return copies to prevent accidental mutation of stored records.

## Tests and checks

```sh
npm run typecheck
npm run build
npm test
```

Type-checking includes application and test files. Tests cover creation, validation, retrieval, status changes, async completion/failure, duplicate processing prevention, manual-update coordination, and error responses. No test waits three seconds. TypeScript is pinned to 5.9.3 for ts-jest compatibility. No linter is configured.

Supertest needs permission to open a temporary local listener. Environments that reject local sockets with `EPERM` cannot run the HTTP tests. Service tests can run independently:

```sh
npm test -- --testNamePattern='payment service'
```

## Limitations

All state is lost on restart. Storage has no capacity limit, and background work has no durable queue or crash recovery. There is no authentication, rate limiting, or cross-process coordination. Every POST creates a new payment. These are deliberate simplifications for the assessment; a real payment service would require durable storage, idempotency, access control, and recovery of unfinished work.
