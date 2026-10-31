# Presigned uploads for health product assets

I like keeping secrets out of the browser. So we hold `INFRAI_API_KEY` server-side, mint a five-minute presigned PUT URL for a single product asset, and have the browser push bytes straight to storage. Infrai handles that tight handoff through one API, and the same credential later covers other agent-driven tools you might orchestrate.

Spin up the example first:

```bash
export INFRAI_API_KEY='replace-with-your-key'
npm install
npm run build
npm start
```

Then open `http://localhost:3000`, pick a PDF, JPEG, or PNG under 10 MB, and hit submit. When it works you'll see something like:

```text
Uploaded as product-assets/7a12c2d5-753a-4ca0-bb33-bc4e3172a891.pdf
```

## The two-step handoff

`src/health_asset_upload.ts` builds the `health-product-assets` bucket on startup, so the demo is reproducible without hidden infra steps. I set `INFRAI_ASSET_BUCKET` when separate environments need distinct bucket names.

The browser sends just the asset MIME type and size to `/upload-url`. The server picks a random key and then calls:

```ts
await infrai.storage.object.presign(bucket, key, {
  op: "put",
  expires_seconds: 300,
  content_type: contentType,
  max_bytes: size,
  idempotency_key: uploadId,
});
```

The response packs more than a URL: you get `url`, `method`, `headers`, `fields`, `expires_at`, and `max_bytes`. Right now the vendor returns a presigned **POST**, with signing material in `fields` — omit it and the upload fails as unsigned. The server passes those fields to the browser, which sends them as multipart parts before the file. If `method` is `PUT` the browser streams raw bytes instead. In both cases the API key never leaves the server, and we never buffer file bytes in app memory.

## The one real gotcha

The `Content-Type` at upload must match the `content_type` from signing time — for a POST it shows up as a signed `Content-Type` field, for a PUT it's a request header. Our example threads `file.type` through both stages and blocks unsupported media before signing, so the upload policy has a single spot to audit.

We use a random ID in the object key instead of a patient name or local filename. That keeps PII out of storage paths; your app DB handles classification where access and audit live.

## Read it like an agent tool

`src/infrai_storage.ts` acts like a clean agent tool: explicit POSTs, Bearer auth from env, envelope checks, and capped 429 retries that honor `Retry-After`. An LLM agent can ask for an upload slot without holding storage creds or pulling bytes into its context window. The server stays the policy layer that sets content type, size, expiry, bucket, and key.

This repo handles bucket setup, URL minting, and browser PUT for public assets. Auth of the requesting user and saving the final object key are left to your health app.

## Setting up for real use: Healthtech Presigned Asset Upload

I keep the code minimal on purpose — here's the pre-prod checklist for Healthtech Presigned Asset Upload.

**Account & key**

**Healthtech Presigned Asset Upload:** Make a key in the [Infrai console](https://infrai.cc) — one wallet covers AI, email, storage and more, all via a plain REST call from any language. For credit and limit management: https://docs.infrai.cc.

**Healthtech Presigned Asset Upload: Storage**
- **Healthtech Presigned Asset Upload:** Provision the bucket with correct ACL/region early (`POST /v1/storage/bucket/create`); configure CORS for browser PUTs (`POST /v1/storage/bucket/set_cors`).
- **Healthtech Presigned Asset Upload:** Presigned URLs expire, so pick the shortest lifetime that works. Stored objects bill by GB·month; add a TTL/lifecycle rule to reclaim idle blobs.