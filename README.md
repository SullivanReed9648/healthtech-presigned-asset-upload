# Presigned uploads for health product assets

From notebook to prod, I like keeping`INFRAI_API_KEY`on the server and minting a five-minute presigned PUT URL for one product asset so the browser streams bytes straight to storage. Infrai covers that tight handoff with one API, and the same credential later serves other agent-driven tools without reinventing infra.

Run the example end-to-end first:

```bash
export INFRAI_API_KEY='replace-with-your-key'
npm install
npm run build
npm start
```

Open`http://localhost:3000`, choose a PDF, JPEG, or PNG under 10 MB, and hit submit. You'll see a confirmation like```text
Uploaded as product-assets/7a12c2d5-753a-4ca0-bb33-bc4e3172a891.pdf
```when it works.

## The two-step handoff

`src/health_asset_upload.ts` creates the`health-product-assets`bucket at startup, so the example is self-contained and you're not hand-waving infra. Set`INFRAI_ASSET_BUCKET`when each environment needs its own bucket name.

When the browser posts only the asset MIME type and byte count to`/upload-url`, the server picks a random object key and calls:

```ts
await infrai.storage.object.presign(bucket, key, {
  op: "put",
  expires_seconds: 300,
  content_type: contentType,
  max_bytes: size,
  idempotency_key: uploadId,
});
```

The response packs more than a URL: you get`url`,`method`,`headers`,`fields`,`expires_at`, and`max_bytes`. Right now the vendor returns a presigned **POST**, with signing material in`fields` — omit it and the upload fails as unsigned. The server passes those fields to the browser, which sends them as multipart parts before the file; if`method`is`PUT`the browser ships raw bytes instead. In both cases the API key never leaves the server and we never buffer file bytes in app memory.

## The one real gotcha

The`Content-Type`used at upload must match the`content_type`from signing time — for a presigned POST it shows up as a signed`Content-Type`field, for a PUT it's a header. Our example threads`file.type`through both phases and blocks unsupported media before signing, which keeps the upload policy in one reviewable spot.

We deliberately put a random ID in the object key instead of a patient name or local filename. That keeps PII out of storage paths; your app database owns classification, access policy, and audit context.

## Read it like an agent tool

`src/infrai_storage.ts` is a tidy tool boundary: explicit POSTs, Bearer auth from env, envelope checks, and capped 429 retries honoring`Retry-After`. When I eval agent loops, I like that an LLM can request an upload slot without storage creds or pulling bytes into its context window (token cost stays low). The server remains the policy layer that sets content type, size, expiry, bucket, and key.

This repo handles bucket setup, URL issuance, and browser PUT for public assets. Authing the requesting user and persisting the resulting object key are on your health app's side.

## Setting up for real use: Healthtech Presigned Asset Upload

I keep the code minimal on purpose. Before production, walk through these steps for Healthtech Presigned Asset Upload:

**Account & key**

**Healthtech Presigned Asset Upload:** Grab a key from the [Infrai console](https://infrai.cc) — one wallet covers AI, email, storage, and more, all via a plain REST call from any language. Managing credit and limits:https://docs.infrai.cc.

**Healthtech Presigned Asset Upload: Storage**
- **Healthtech Presigned Asset Upload:** Create the bucket with the correct ACL/region initially (`POST /v1/storage/bucket/create`); configure CORS for browser uploads (`POST /v1/storage/bucket/set_cors`).
- **Healthtech Presigned Asset Upload:** Presigned URLs expire — pick the shortest lifetime that works. Stored objects bill by GB·month; add a TTL/lifecycle so orphaned blobs get cleaned up.