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

// getComponents returns the component library for the palette (FR-065). With a
// projectDir it requests the merged shared ∪ project library plus per-file scan
// warnings (FR-121i); with none it returns the shared library alone. Resolves to
// { components, warnings } (warnings defaults to []).
export async function getComponents(projectDir) {
  const q = projectDir ? "?project=" + encodeURIComponent(projectDir) : "";
  const body = await request("/components" + q);
  return { components: body.components, warnings: body.warnings ?? [] };
}

// createComponent submits authored component YAML for the current project
// (FR-007a/FR-121i): the server writes it under <projectDir>/components/ and
// returns the parsed ComponentType so the caller can add the tile live. Rejects
// with the server's message on a duplicate id/filename (in the project or the
// shared library) or a validation failure.
export async function createComponent(yaml, projectDir) {
  const body = await request("/components", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ yaml, project: projectDir }),
  });
  return body.component;
}

// getDefaults returns server defaults, including the designs root (FR-050).
export async function getDefaults() {
  return request("/defaults");
}

// listDir lists a directory for the file-navigation dialog (FR-053). An empty
// path defaults to the designs root. `exts` overrides the default *.json filter
// (the ROM picker passes ["bin","hex"], FR-114e; ["-"] lists directories only,
// §6.5). Project manifests are excluded unless `includeManifests` is set (the
// Open Project picker sets it, FR-121a/FR-121b).
export async function listDir(path = "", exts = null, { includeManifests = false } = {}) {
  const params = [];
  if (path) params.push(`path=${encodeURIComponent(path)}`);
  if (exts && exts.length) params.push(`exts=${encodeURIComponent(exts.join(","))}`);
  if (includeManifests) params.push("manifests=1");
  return request("/files" + (params.length ? "?" + params.join("&") : ""));
}

// projectInfo resolves a project directory's identity (FR-121a, §6.5a):
// { dir, name, manifestFile, mainDesign, warnings }.
export async function projectInfo(dir) {
  return request("/project/info?dir=" + encodeURIComponent(dir));
}

// projectCreate makes a new project directory with a fresh manifest (FR-121b)
// and returns its info. Rejects with the server's message when the path
// already exists (409) or its parent is missing.
export async function projectCreate(path) {
  return request("/project/create", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path }),
  });
}

// projectDuplicate copies the entire project directory src to the new
// directory dst (FR-121f) and returns the duplicate's info. A mid-copy
// failure leaves the partial destination; the caller reports it.
export async function projectDuplicate(src, dst) {
  return request("/project/duplicate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ src, dst }),
  });
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

// writeRamFile writes a RAM's persistent-content file on Stop (FR-114g): the raw
// bytes (a Uint8Array the caller formatted per the .bin/.hex extension) are POSTed
// as the request body. The write analogue of readRomFile. Rejects with the
// server's message (e.g. a non-.bin/.hex path or an over-size body).
export async function writeRamFile(path, bytes) {
  const resp = await fetch(BASE + "/ramfile?path=" + encodeURIComponent(path), {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream" },
    body: bytes,
  });
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

// saveTextFile writes verbatim text through POST /file/save (§6.4): the C
// generator's delivery path (FR-116). The design-save endpoint carries only
// valid JSON (the server re-indents it), so C source cannot ride it.
export async function saveTextFile(path, content) {
  const body = await request("/file/save", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, content }),
  });
  return body.path;
}

// fetchStaticText loads a static SPA asset as text — the C runtime pair
// (/cgen/runtime.{h,c}) the generator copies beside its output (§6.17).
export async function fetchStaticText(path) {
  const resp = await fetch(path);
  if (!resp.ok) throw new Error(`GET ${path}: HTTP ${resp.status}`);
  return resp.text();
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
