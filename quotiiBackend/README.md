# quotiiBackend

Node.js API for Nuggets. It owns guest identity, GraphQL status, and Book AI token streams.

The mobile app talks to this service. Cloud indexing of PDFs lives on [quotiiPdfProcessor](../quotiiPdfProcessor/README.md).

## Role

After **Add to library**, the app POSTs the PDF here (`POST /index`). This service forwards it to the PdfProcessor and returns `202` so the **Reader** stays usable.

When **Cloud indexing** is `ready`, **Book AI** (Explain, Ask, Summary) streams tokens over HTTP SSE. GraphQL is for auth, book metadata, and index status — not for LLM tokens.

Glossary: [`quotii/CONTEXT.md`](../quotii/CONTEXT.md). Decisions: [`docs/adr/`](../docs/adr/) (0011, 0012, 0013, 0018).

## Prerequisites

- Node 20+
- MongoDB (same cluster as the PdfProcessor)
- PdfProcessor running on port 8000 for indexing
- Redis on `localhost:6379` if you use the legacy BullMQ notification / Unsplash queues (override with `REDIS_URL` or `REDIS_HOST`/`REDIS_PORT`)
- Firebase Admin credentials via environment variables (optional; skipped when `FIREBASE_ENABLED=false` or `APP_ENV=test`)

## Setup

```bash
cd quotiiBackend
npm install
```

Copy `.env` from an existing local file, or create one:

```
MONGO_DB_CONNECTION_STRING=mongodb+srv://USER:PASSWORD@HOST/DB?retryWrites=true&w=majority
PDF_PROCESSOR_ENDPOINT=http://localhost:8000
JWT_ACCESS_SECRET=
JWT_REFRESH_SECRET=
JWT_REFRESH_EXPIRATION=7d
APP_ID=

DEEPSEEK_API_KEY=
# DEEPSEEK_BASE_URL=https://api.deepseek.com
# DEEPSEEK_MODEL=deepseek-v4-flash

R2_ENDPOINT=https://ACCOUNT_ID.r2.cloudflarestorage.com
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET=nuggets-dev
R2_REGION=auto
# OBJECT_STORE=fake

# REDIS_URL=redis://localhost:6379
# REDIS_HOST=localhost
# REDIS_PORT=6379

# FIREBASE_ENABLED=true
# FIREBASE_PROJECT_ID=
# FIREBASE_CLIENT_EMAIL=
# FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"

# UNSPLASH_ACCESS_KEY=
# EXPO_ACCESS_TOKEN=
```

Mongo URI here is `MONGO_DB_CONNECTION_STRING`. The PdfProcessor uses `MONGO_URI`. Same database, different names.

If R2 keys are missing, or `OBJECT_STORE=fake`, Book context reads/writes go to an in-memory fake. Book AI then cannot load a real blob.

## Run

```bash
npm run dev
```

Listens on `http://localhost:3000`. GraphQL WebSocket subscriptions are at `/subscriptions`.

Point the app at this host with `EXPO_PUBLIC_DEV_API_URL`.

## HTTP

All of these except GraphQL require a JWT (`Authorization: Bearer …`). Guests register with GraphQL `registerGuest`.

| Method | Path | Notes |
| --- | --- | --- |
| `POST` | `/index` | Eager Cloud indexing. Multipart: `file`, `title`, `jobId`. Forwards to PdfProcessor `/index-pdf`. Returns `202`. |
| `POST` | `/explain` | SSE. Selection + typed question. Gates on index ready + loadable Book context. |
| `POST` | `/ask` | SSE. Book chat. Client sends the turn window. Does not persist transcripts. |
| `POST` | `/summary` | SSE. On-demand chapter summary. Caches `summaryText` on the Book row. |
| `POST` | `/` | GraphQL (Apollo). |
| `GET` | `/nuggetOfTheDay/:userId` | Legacy. Capability-off on mobile. |
| `POST` | `/upload` | Legacy quote extraction. Forwards to PdfProcessor `/process-pdf`, which that service no longer serves. |

PDF uploads are capped at 50 MB. Auth runs before Multer writes the file to disk.

## GraphQL (current path)

- `registerGuest`, `loginWithApple`, `refreshTokens`, `whoAmI`, `getUser`
- `getUserBooks`, `getBookInfo`, `getBookIndexStatuses`, `retryCloudIndex`
- `myBookIndexStatuses` (subscription; JWT on the WebSocket handshake)

`retryCloudIndex` calls PdfProcessor `POST /retry-index`. Quote / Nugget of the Day / subscription fields still exist for legacy clients.

Index status values: `queued` → `processing` → `ready` | `failed`. On this service, **ready** means Mongo says `ready` **and** the Book context blob loads from object storage (ADR 0018). A missing blob is persisted as `failed`.

## Layout

```
src/index.ts          Express + Apollo + REST + SSE
src/bookAi/           Explain / Ask / Summary, BookIndex, DeepSeek
src/graphql/          Nexus types and resolvers
src/database/         Mongoose schemas, Mongo watchers
src/objectStore/      R2 adapter + in-memory fake
src/repository/       Book / user / quote access
src/__tests__/        Script-style tests (ts-node)
```

## Tests

```bash
npm test
```

HTTP/API coverage now includes a `Supertest` suite for `/health`, `/index`,
`/explain`, `/ask`, `/summary`, and GraphQL auth flows while keeping the
existing `node:test` + `ts-node` architecture.

Coverage:

```bash
yarn test:coverage
```

Targeted:

```bash
npm run test:cloud-index
npm run test:book-index
npm run test:http
npm run test:explain
npm run test:ask
npm run test:summary
```

These tests use fakes/mocks for Mongo, Redis, object storage, and the
PdfProcessor. They do not need live external services.
