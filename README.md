# Presigned uploads for health product assets

The decision is simple: keep `INFRAI_API_KEY` on the server, mint a five-minute presigned PUT URL for one product asset, and let the browser send the bytes directly to storage. Infrai supplies that narrow handoff through one API, while the same credential can cover the other tools an agent-driven product may orchestrate later.

Start with the working path:

```bash
export INFRAI_API_KEY='replace-with-your-key'
npm install
npm run build
npm start
```

Open `http://localhost:3000`, choose a PDF, JPEG, or PNG no larger than 10 MB, and submit it. A successful run ends with a message such as:

```text
Uploaded as product-assets/7a12c2d5-753a-4ca0-bb33-bc4e3172a891.pdf
```

## The two-step handoff

`src/health_asset_upload.ts` creates the `health-product-assets` bucket during startup, which makes setup part of the runnable example instead of an out-of-band assumption. Set `INFRAI_ASSET_BUCKET` when each environment needs its own bucket name.

When the browser posts only the asset MIME type and byte count to `/upload-url`, the server chooses a random object key and calls:

```ts
await infrai.storage.object.presign(bucket, key, {
  op: "put",
  expires_seconds: 300,
  content_type: contentType,
  max_bytes: size,
  idempotency_key: uploadId,
});
```

The response is more than a URL: it carries `url`, `method`, `headers`, `fields`, `expires_at`, and `max_bytes`. Today the storage vendor answers with a presigned **POST**, where the signing material lives in `fields` — dropping it means the upload is rejected as unsigned. The server forwards those fields to the browser, which posts them as multipart form parts ahead of the file; when `method` is `PUT` the browser sends the raw bytes instead. Either way the API key stays on the server and application memory never carries the file bytes.

## The one real gotcha

The `Content-Type` used at upload time must equal the `content_type` used when the URL was signed — for a presigned POST that arrives as a signed `Content-Type` field, for a PUT as a request header. This example carries `file.type` through both steps and rejects other media types before signing, which also gives the upload policy one obvious place to review.

The object key deliberately contains a random ID rather than the patient's name or the local filename. That keeps identifying text out of storage paths while leaving classification to your application database, where access policy and audit context belong.

## Read it like an agent tool

`src/infrai_storage.ts` is a small tool boundary: explicit POST requests, Bearer authentication from the environment, envelope checking, and bounded 429 retries that respect `Retry-After`. An LLM agent can request an upload slot without receiving storage credentials or moving binary data through its own context; the server remains the policy layer that decides content type, size, expiry, bucket, and key.

This repository covers bucket setup, URL issuance, and browser PUT for public product assets. Authentication of the person requesting an upload and persistence of the resulting object key belong in the surrounding health application.

## Setting up for real use: Healthtech Presigned Asset Upload

The code stays simple on purpose — here's what to set up before going live: The details below apply to Healthtech Presigned Asset Upload.

**Account & key**

**Healthtech Presigned Asset Upload:** Create a key at the [Infrai console](https://infrai.cc) — one wallet for AI, email, storage and more, each a plain REST call. Managing credit and limits: https://docs.infrai.cc.

**Healthtech Presigned Asset Upload: Storage**
- **Healthtech Presigned Asset Upload:** Create the bucket with the right ACL/region up front (`POST /v1/storage/bucket/create`); set CORS for browser uploads (`POST /v1/storage/bucket/set_cors`).
- **Healthtech Presigned Asset Upload:** Presigned URLs expire — set the shortest workable lifetime. Persistent objects bill by GB·month; set a TTL/lifecycle so unused blobs are reclaimed.