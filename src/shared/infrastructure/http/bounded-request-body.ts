export class RequestBodyError extends Error {
  constructor(readonly status: 400 | 408 | 413) {
    super("Request body could not be read within its limits");
    this.name = "RequestBodyError";
  }
}

/** Bound bytes while reading: Content-Length is an untrusted hint, not a limit. */
export async function readBoundedRequestBody(
  request: Request,
  limits: Readonly<{ maxBytes: number; timeoutMs: number }>,
): Promise<Uint8Array> {
  const declared = request.headers.get("content-length");
  if (declared !== null && !/^\d+$/.test(declared)) throw new RequestBodyError(400);
  if (declared !== null && Number(declared) > limits.maxBytes) throw new RequestBodyError(413);
  if (!request.body) throw new RequestBodyError(400);
  const reader = request.body.getReader();
  const expiresAt = performance.now() + limits.timeoutMs;
  // One bounded buffer also prevents millions of tiny chunks growing an unbounded array.
  const bytes = new Uint8Array(limits.maxBytes);
  let size = 0;
  let complete = false;
  try {
    for (;;) {
      const remainingMs = expiresAt - performance.now();
      if (remainingMs <= 0) throw new RequestBodyError(408);
      const { done, value } = await readBeforeDeadline(reader, remainingMs);
      if (done) { complete = true; break; }
      // Empty chunks cannot advance the byte bound and may starve the timer queue.
      if (value.byteLength === 0) throw new RequestBodyError(400);
      if (value.byteLength > limits.maxBytes - size) throw new RequestBodyError(413);
      bytes.set(value, size);
      size += value.byteLength;
    }
    return bytes.subarray(0, size);
  } catch (error) {
    if (error instanceof RequestBodyError) throw error;
    throw new RequestBodyError(400);
  } finally {
    if (!complete) {
      // A stalled source can also stall cancellation. Never await cleanup past the deadline.
      void reader.cancel().catch(() => { /* Preserve the bounded read failure. */ });
    }
    reader.releaseLock();
  }
}

async function readBeforeDeadline(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  remainingMs: number,
): Promise<ReadableStreamReadResult<Uint8Array>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new RequestBodyError(408)), remainingMs);
  });
  try { return await Promise.race([reader.read(), deadline]); }
  finally { clearTimeout(timer); }
}
