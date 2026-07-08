package server

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func newTestServer(t *testing.T, dataDir string) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(NewRouter(testLibrary(), dataDir, t.TempDir(), t.TempDir()))
	t.Cleanup(srv.Close)
	return srv
}

func TestDefaultsEndpoint(t *testing.T) {
	dataDir := t.TempDir()
	srv := newTestServer(t, dataDir)

	resp, err := http.Get(srv.URL + "/api/v1/defaults")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}
	var body struct {
		DataDir string `json:"dataDir"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	if body.DataDir != dataDir {
		t.Fatalf("dataDir = %q, want %q", body.DataDir, dataDir)
	}
}

func TestFilesEndpoint(t *testing.T) {
	dataDir := t.TempDir()
	mustWrite(t, filepath.Join(dataDir, "a.json"), "{}")
	if err := os.Mkdir(filepath.Join(dataDir, "sub"), 0o755); err != nil {
		t.Fatal(err)
	}
	srv := newTestServer(t, dataDir)

	// Empty path defaults to the data dir.
	var listing DirListing
	getJSON(t, srv.URL+"/api/v1/files", http.StatusOK, &listing)
	names := entryNames(listing)
	if !names["a.json"] || !names["sub"] {
		t.Fatalf("entries missing expected items: %v", names)
	}

	// Errors.
	status(t, srv.URL+"/api/v1/files?path="+url.QueryEscape("relative/dir"), http.StatusBadRequest)
	status(t, srv.URL+"/api/v1/files?path="+url.QueryEscape(filepath.Join(dataDir, "missing")), http.StatusNotFound)
	status(t, srv.URL+"/api/v1/files?path="+url.QueryEscape(filepath.Join(dataDir, "a.json")), http.StatusForbidden)
}

func TestDesignLoadEndpoint(t *testing.T) {
	dataDir := t.TempDir()
	good := filepath.Join(dataDir, "d.json")
	mustWrite(t, good, `{"formatVersion":1,"name":"x"}`)
	bad := filepath.Join(dataDir, "bad.json")
	mustWrite(t, bad, "{nope")
	srv := newTestServer(t, dataDir)

	var body struct {
		Design json.RawMessage `json:"design"`
	}
	getJSON(t, srv.URL+"/api/v1/design/load?path="+url.QueryEscape(good), http.StatusOK, &body)
	if !strings.Contains(string(body.Design), `"formatVersion"`) {
		t.Fatalf("design payload = %s", body.Design)
	}

	status(t, srv.URL+"/api/v1/design/load", http.StatusBadRequest) // empty path
	status(t, srv.URL+"/api/v1/design/load?path="+url.QueryEscape(filepath.Join(dataDir, "none.json")), http.StatusNotFound)
	status(t, srv.URL+"/api/v1/design/load?path="+url.QueryEscape(bad), http.StatusUnprocessableEntity)
}

func TestDesignSaveEndpoint(t *testing.T) {
	dataDir := t.TempDir()
	srv := newTestServer(t, dataDir)
	target := filepath.Join(dataDir, "saved.json")

	reqBody, _ := json.Marshal(map[string]any{
		"path":   target,
		"design": json.RawMessage(`{"formatVersion":1,"name":"y"}`),
	})
	resp, err := http.Post(srv.URL+"/api/v1/design/save", "application/json", strings.NewReader(string(reqBody)))
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}
	var out struct {
		Path string `json:"path"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		t.Fatal(err)
	}
	if out.Path != target {
		t.Fatalf("path = %q, want %q", out.Path, target)
	}
	if _, err := os.Stat(target); err != nil {
		t.Fatalf("file not written: %v", err)
	}

	// Relative path -> 400.
	rel, _ := json.Marshal(map[string]any{"path": "relative.json", "design": json.RawMessage(`{}`)})
	postStatus(t, srv.URL+"/api/v1/design/save", string(rel), http.StatusBadRequest)
	// Non-JSON body -> 400.
	postStatus(t, srv.URL+"/api/v1/design/save", "{not json", http.StatusBadRequest)
}

func TestFileSaveEndpoint(t *testing.T) {
	dataDir := t.TempDir()
	srv := newTestServer(t, dataDir)
	target := filepath.Join(dataDir, "gen.c")

	// Verbatim text (not JSON): written byte-for-byte (§6.4, FR-116).
	content := "#include \"runtime.h\"\n/* not JSON: {][ */\nint x;\n"
	reqBody, _ := json.Marshal(map[string]any{"path": target, "content": content})
	resp, err := http.Post(srv.URL+"/api/v1/file/save", "application/json", strings.NewReader(string(reqBody)))
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}
	got, err := os.ReadFile(target)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != content {
		t.Fatalf("content = %q, want %q", got, content)
	}

	// Relative path -> 400.
	rel, _ := json.Marshal(map[string]any{"path": "relative.c", "content": "x"})
	postStatus(t, srv.URL+"/api/v1/file/save", string(rel), http.StatusBadRequest)
	// Non-JSON body -> 400.
	postStatus(t, srv.URL+"/api/v1/file/save", "{not json", http.StatusBadRequest)
}

func TestRamFileEndpoint(t *testing.T) {
	dataDir := t.TempDir()
	srv := newTestServer(t, dataDir)
	target := filepath.Join(dataDir, "ram.bin")
	endpoint := srv.URL + "/api/v1/ramfile?path=" + url.QueryEscape(target)

	// Raw body bytes written verbatim (FR-114g).
	body := "\x00\xa5\xff\x10"
	resp, err := http.Post(endpoint, "application/octet-stream", strings.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}
	if got, _ := os.ReadFile(target); string(got) != body {
		t.Fatalf("written = %v, want %v", got, []byte(body))
	}

	// Wrong extension -> 400.
	txt := srv.URL + "/api/v1/ramfile?path=" + url.QueryEscape(filepath.Join(dataDir, "ram.txt"))
	postRawStatus(t, txt, "x", http.StatusBadRequest)
	// Relative path -> 400.
	postRawStatus(t, srv.URL+"/api/v1/ramfile?path=relative.bin", "x", http.StatusBadRequest)
	// Wrong method (GET) -> 405.
	getStatus(t, endpoint, http.StatusMethodNotAllowed)
}

// --- helpers ---

func postRawStatus(t *testing.T, url, body string, want int) {
	t.Helper()
	resp, err := http.Post(url, "application/octet-stream", strings.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != want {
		t.Fatalf("POST %s status = %d, want %d", url, resp.StatusCode, want)
	}
}

func getStatus(t *testing.T, url string, want int) {
	t.Helper()
	resp, err := http.Get(url)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != want {
		t.Fatalf("GET %s status = %d, want %d", url, resp.StatusCode, want)
	}
}

func getJSON(t *testing.T, url string, wantStatus int, v any) {
	t.Helper()
	resp, err := http.Get(url)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != wantStatus {
		t.Fatalf("GET %s status = %d, want %d", url, resp.StatusCode, wantStatus)
	}
	if v != nil {
		if err := json.NewDecoder(resp.Body).Decode(v); err != nil {
			t.Fatal(err)
		}
	}
}

func status(t *testing.T, url string, want int) {
	t.Helper()
	resp, err := http.Get(url)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != want {
		t.Fatalf("GET %s status = %d, want %d", url, resp.StatusCode, want)
	}
}

func postStatus(t *testing.T, url, body string, want int) {
	t.Helper()
	resp, err := http.Post(url, "application/json", strings.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != want {
		t.Fatalf("POST %s status = %d, want %d", url, resp.StatusCode, want)
	}
}

func entryNames(l DirListing) map[string]bool {
	m := map[string]bool{}
	for _, e := range l.Entries {
		m[e.Name] = true
	}
	return m
}
