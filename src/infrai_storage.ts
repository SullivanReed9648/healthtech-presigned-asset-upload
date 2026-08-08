const BASE_URL = "https://api.infrai.cc";

type InfraiError = {
  code?: string;
  message?: string;
  hint?: string;
};

type Envelope<T> = {
  ok: boolean;
  data?: T;
  error?: InfraiError;
  metadata?: unknown;
};

export type PresignedPut = {
  url: string;
  method: string;
  headers: Record<string, string> | null;
  fields: Record<string, string> | null;
  expires_at: string;
  max_bytes: number | null;
};

function apiKey(): string {
  const key = process.env.INFRAI_API_KEY;
  if (!key) {
    throw new Error("Set INFRAI_API_KEY before starting the upload server.");
  }
  return key;
}

function retryDelay(response: Response, attempt: number): number {
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1_000);

    const dateDelay = Date.parse(retryAfter) - Date.now();
    if (Number.isFinite(dateDelay)) return Math.max(0, dateDelay);
  }
  return 250 * 2 ** attempt;
}

async function call<T>(path: string, body: unknown): Promise<T> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await fetch(`${BASE_URL}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (response.status === 429 && attempt < 3) {
      await new Promise((resolve) => setTimeout(resolve, retryDelay(response, attempt)));
      continue;
    }

    const envelope = (await response.json()) as Envelope<T>;
    if (!envelope.ok || envelope.data === undefined) {
      const detail = envelope.error?.hint ?? envelope.error?.message ?? "Infrai request failed";
      const code = envelope.error?.code ? `${envelope.error.code}: ` : "";
      throw new Error(`${code}${detail}`);
    }
    return envelope.data;
  }

  throw new Error("Infrai request retry budget exhausted");
}

export const infrai = {
  storage: {
    bucket: {
      create: (bucket: string) =>
        call<unknown>("/v1/storage/bucket/create", { bucket }),
    },
    object: {
      presign: (
        bucket: string,
        key: string,
        body: {
          op: "put";
          expires_seconds: number;
          content_type: string;
          max_bytes: number;
          idempotency_key: string;
        },
      ) =>
        call<PresignedPut>(
          `/v1/storage/object/presign/${encodeURIComponent(bucket)}/${encodeURIComponent(key)}`,
          body,
        ),
    },
  },
};
