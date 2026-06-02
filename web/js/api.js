// REST client for the local server (§6.12). All requests target same-origin
// /api/v1/* — localhost only, no external network calls (NFR-002, IR-001).

const BASE = "/api/v1";

// request performs a fetch and rejects with the server's error envelope message
// ({"error":...}) on a non-2xx response.
async function request(path, options) {
  const resp = await fetch(BASE + path, options);
  if (!resp.ok) {
    let message = `${resp.status} ${resp.statusText}`;
    try {
      const body = await resp.json();
      if (body && body.error) message = body.error;
    } catch (_) {
      // non-JSON error body; keep the status line
    }
    throw new Error(message);
  }
  return resp.json();
}

// getComponents returns the parsed component library (FR-065).
export async function getComponents() {
  const body = await request("/components");
  return body.components;
}
