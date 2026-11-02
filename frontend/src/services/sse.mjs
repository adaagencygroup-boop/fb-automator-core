/** Fetch-based SSE so desktop clients can authenticate with request headers. */
export async function readSSE(response, onMessage, signal) {
  const reader = response.body.getReader();
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal?.addEventListener("abort", cancel, { once: true });
  const decoder = new TextDecoder();
  let pending = "";
  let data = [];
  try {
    while (!signal?.aborted) {
      const { value, done } = await reader.read();
      if (done) break;
      pending += decoder.decode(value, { stream: true });
      let newline;
      while ((newline = pending.indexOf("\n")) !== -1) {
        const line = pending.slice(0, newline).replace(/\r$/, "");
        pending = pending.slice(newline + 1);
        if (line === "") {
          if (data.length) onMessage({ data: data.join("\n") });
          data = [];
        } else if (line.startsWith("data:")) {
          data.push(line.slice(5).replace(/^ /, ""));
        }
      }
    }
  } finally {
    signal?.removeEventListener("abort", cancel);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export function connectSSE(url, {
  getHeaders, onOpen, onMessage, onError, onUnauthorized, retryDelay = 3000,
}) {
  const controller = new AbortController();
  let timer;
  async function connect() {
    try {
      const request = () => fetch(url, {
        headers: { Accept: "text/event-stream", ...getHeaders() },
        credentials: "include",
        cache: "no-store",
        signal: controller.signal,
      });
      let response = await request();
      if (response.status === 401 && onUnauthorized) {
        await response.body?.cancel();
        await onUnauthorized();
        if (controller.signal.aborted) return;
        response = await request();
      }
      if (controller.signal.aborted) {
        await response.body?.cancel();
        return;
      }
      if (!response.ok || !response.headers.get("content-type")?.includes("text/event-stream")) {
        await response.body?.cancel();
        throw new Error(`SSE connection failed: HTTP ${response.status}`);
      }
      onOpen();
      await readSSE(response, onMessage, controller.signal);
      if (!controller.signal.aborted) throw new Error("SSE connection closed");
    } catch (error) {
      if (!controller.signal.aborted) {
        onError(error);
        timer = setTimeout(connect, retryDelay);
      }
    }
  }
  void connect();
  return { close() { clearTimeout(timer); controller.abort(); } };
}
