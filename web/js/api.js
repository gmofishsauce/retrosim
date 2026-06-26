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

// createComponent submits authored component YAML, persisting it into the
// library and returning the parsed ComponentType so the caller can add the tile
// live (FR-007a). Rejects with the server's message on a duplicate part number or
// a validation failure.
export async function createComponent(yaml) {
  const body = await request("/components", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ yaml }),
  });
  return body.component;
}

// getDefaults returns server defaults, including the designs root (FR-050).
export async function getDefaults() {
  return request("/defaults");
}

// listDir lists a directory for the file-navigation dialog (FR-053). An empty
// path defaults to the designs root. `exts` overrides the default *.json filter
// (the ROM picker passes ["bin","hex"], FR-114e).
export async function listDir(path = "", exts = null) {
  const params = [];
  if (path) params.push(`path=${encodeURIComponent(path)}`);
  if (exts && exts.length) params.push(`exts=${encodeURIComponent(exts.join(","))}`);
  return request("/files" + (params.length ? "?" + params.join("&") : ""));
}

// readRomFile fetches a ROM content file's raw bytes (FR-114e), as a Uint8Array.
// Used by the simulator's Run-time ROM loader. Rejects with the server's message
// (e.g. a missing file or a non-.bin/.hex path).
export async function readRomFile(path) {
  const resp = await fetch(BASE + "/romfile?path=" + encodeURIComponent(path));
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
  return new Uint8Array(await resp.arrayBuffer());
}

// loadDesign reads a design file, returning the parsed design object (FR-052).
export async function loadDesign(path) {
  const body = await request("/design/load?path=" + encodeURIComponent(path));
  return body.design;
}

// loadVectorFile / saveVectorFile read and write a `.tv` test-vector file (§7.7,
// FR-115a). The payload is plain JSON, so it rides the design load/save endpoints
// — which neither interpret nor extension-check the body — rather than adding a
// dedicated route. Returns the parsed doc object / the written path.
export async function loadVectorFile(path) {
  const body = await request("/design/load?path=" + encodeURIComponent(path));
  return body.design;
}
export async function saveVectorFile(path, doc) {
  const body = await request("/design/save", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, design: doc }),
  });
  return body.path;
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
