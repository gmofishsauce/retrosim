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

// getDefaults returns server defaults, including the designs root (FR-050).
export async function getDefaults() {
  return request("/defaults");
}

// listDir lists a directory for the file-navigation dialog (FR-053). An empty
// path defaults to the designs root.
export async function listDir(path = "") {
  const q = path ? `?path=${encodeURIComponent(path)}` : "";
  return request("/files" + q);
}

// loadDesign reads a design file, returning the parsed design object (FR-052).
export async function loadDesign(path) {
  const body = await request("/design/load?path=" + encodeURIComponent(path));
  return body.design;
}

// ping checks server reachability (FR-089 heartbeat); resolves on any healthy
// response, rejects when the server is gone.
export async function ping() {
  return request("/ping");
}

// saveDesign writes a design object to path (FR-046).
export async function saveDesign(path, design) {
  const body = await request("/design/save", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, design }),
  });
  return body.path;
}
