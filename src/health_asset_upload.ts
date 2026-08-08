import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { infrai } from "./infrai_storage.ts";

const BUCKET = process.env.INFRAI_ASSET_BUCKET ?? "health-product-assets";
const PORT = Number(process.env.PORT ?? 3000);
const MAX_BYTES = 10 * 1024 * 1024;
const ACCEPTED_TYPES = new Set(["application/pdf", "image/jpeg", "image/png"]);

const page = `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Health asset upload</title>
<style>
  body { font: 16px system-ui; max-width: 40rem; margin: 4rem auto; padding: 0 1rem; color: #17212b; }
  form { display: grid; gap: 1rem; }
  button { width: fit-content; padding: .6rem 1rem; }
  output { min-height: 1.5rem; color: #17653a; }
</style>
<h1>Upload a product asset</h1>
<p>Choose a PDF, JPEG, or PNG up to 10 MB.</p>
<form id="upload-form">
  <input id="asset" type="file" accept="application/pdf,image/jpeg,image/png" required>
  <button type="submit">Upload directly</button>
  <output id="status"></output>
</form>
<script>
  const form = document.querySelector("#upload-form");
  const input = document.querySelector("#asset");
  const status = document.querySelector("#status");

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const file = input.files[0];
    status.textContent = "Signing upload";

    const signedResponse = await fetch("/upload-url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contentType: file.type, size: file.size }),
    });
    if (!signedResponse.ok) throw new Error(await signedResponse.text());

    const { uploadUrl, method, headers, fields, key } = await signedResponse.json();
    status.textContent = "Uploading asset";

    // A presigned POST carries its signing material in \`fields\`, which must be sent
    // as multipart form parts before the file. A presigned PUT sends the raw bytes
    // with the signed headers instead.
    const isFormPost = (method || "PUT").toUpperCase() === "POST";
    let body;
    if (isFormPost) {
      body = new FormData();
      for (const [name, value] of Object.entries(fields || {})) body.append(name, value);
      body.append("file", file);
    } else {
      body = file;
    }

    const uploadResponse = await fetch(uploadUrl, {
      method: method || "PUT",
      // The browser sets the multipart boundary itself; only a raw PUT names the type.
      headers: isFormPost ? (headers || {}) : { "Content-Type": file.type, ...(headers || {}) },
      body,
    });
    if (!uploadResponse.ok) throw new Error("Direct upload failed");
    status.textContent = "Uploaded as " + key;
  });
</script>
</html>`;

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function json(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(value));
}

async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
  if (request.method === "GET" && request.url === "/") {
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end(page);
    return;
  }

  if (request.method === "POST" && request.url === "/upload-url") {
    const input = (await readJson(request)) as { contentType?: unknown; size?: unknown };
    if (typeof input.contentType !== "string" || !ACCEPTED_TYPES.has(input.contentType)) {
      json(response, 400, { message: "Choose a PDF, JPEG, or PNG." });
      return;
    }
    if (typeof input.size !== "number" || input.size <= 0 || input.size > MAX_BYTES) {
      json(response, 400, { message: "Asset size must be between 1 byte and 10 MB." });
      return;
    }

    const uploadId = randomUUID();
    const extension = input.contentType === "application/pdf"
      ? "pdf"
      : input.contentType === "image/png" ? "png" : "jpg";
    const key = `product-assets/${uploadId}.${extension}`;
    const signed = await infrai.storage.object.presign(BUCKET, key, {
      op: "put",
      expires_seconds: 300,
      content_type: input.contentType,
      max_bytes: input.size,
      idempotency_key: uploadId,
    });
    json(response, 200, {
      uploadUrl: signed.url,
      method: signed.method,
      headers: signed.headers ?? {},
      fields: signed.fields ?? {},
      expiresAt: signed.expires_at,
      key,
    });
    return;
  }

  json(response, 404, { message: "Route not found." });
}

async function main(): Promise<void> {
  await infrai.storage.bucket.create(BUCKET);
  const server = createServer((request, response) => {
    handle(request, response).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "Unexpected request error";
      json(response, 500, { message });
    });
  });
  server.listen(PORT, () => {
    console.log(`Health asset uploader ready at http://localhost:${PORT}`);
  });
}

await main();
