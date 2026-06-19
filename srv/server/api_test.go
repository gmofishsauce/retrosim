package server

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func testLibrary() *Library {
	lib := newLibrary()
	lib.add(ComponentType{Name: "7400"})
	lib.add(ComponentType{Name: "74138"})
	return lib
}

// GET /api/v1/components returns 200 + JSON {"components":[...]} in name order.
func TestComponentsEndpoint(t *testing.T) {
	srv := httptest.NewServer(NewRouter(testLibrary(), t.TempDir(), t.TempDir(), t.TempDir()))
	defer srv.Close()

	resp, err := http.Get(srv.URL + "/api/v1/components")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}
	if ct := resp.Header.Get("Content-Type"); ct != "application/json" {
		t.Fatalf("Content-Type = %q, want application/json", ct)
	}

	var body struct {
		Components []ComponentType `json:"components"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	if len(body.Components) != 2 {
		t.Fatalf("components len = %d, want 2", len(body.Components))
	}
	if body.Components[0].Name != "7400" || body.Components[1].Name != "74138" {
		t.Fatalf("components order = [%s,%s], want [7400,74138]",
			body.Components[0].Name, body.Components[1].Name)
	}
}

// GET /api/v1/ping answers the connection heartbeat (FR-089).
func TestPingEndpoint(t *testing.T) {
	srv := httptest.NewServer(NewRouter(testLibrary(), t.TempDir(), t.TempDir(), t.TempDir()))
	defer srv.Close()

	resp, err := http.Get(srv.URL + "/api/v1/ping")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}
	var body struct {
		OK bool `json:"ok"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	if !body.OK {
		t.Fatal("ok = false, want true")
	}
}

// An unknown /api/ route returns a JSON error envelope, not HTML.
func TestUnknownAPIRouteJSON404(t *testing.T) {
	srv := httptest.NewServer(NewRouter(testLibrary(), t.TempDir(), t.TempDir(), t.TempDir()))
	defer srv.Close()

	resp, err := http.Get(srv.URL + "/api/v1/nope")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", resp.StatusCode)
	}
	if ct := resp.Header.Get("Content-Type"); ct != "application/json" {
		t.Fatalf("Content-Type = %q, want application/json", ct)
	}
	var body struct {
		Error string `json:"error"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	if body.Error == "" {
		t.Fatal("error envelope is empty")
	}
}

// A method other than GET (read) or POST (create, FR-007a) on the components
// endpoint is rejected with a JSON envelope.
func TestComponentsMethodNotAllowed(t *testing.T) {
	srv := httptest.NewServer(NewRouter(testLibrary(), t.TempDir(), t.TempDir(), t.TempDir()))
	defer srv.Close()

	req, err := http.NewRequest(http.MethodPut, srv.URL+"/api/v1/components", nil)
	if err != nil {
		t.Fatal(err)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusMethodNotAllowed {
		t.Fatalf("status = %d, want 405", resp.StatusCode)
	}
}

// A minimal valid GAL part (FR-066b/066c): server validates structure but treats
// behavior as opaque, so no behavior block is needed here.
const galPartYAML = `type: "22V10"
gal: GAL22V10
partnumber: PC-DECODE-A
pins:
  - { name: I0, side: left, pos: 1, dir: in }
  - { name: O0, side: right, pos: 1, dir: out }
`

// POST /api/v1/components creates a part: 201 + the component, the YAML written
// into the components dir under the part-number filename, and the part visible to
// a following GET — all without restart (FR-007a).
func TestCreateComponent(t *testing.T) {
	compDir := t.TempDir()
	srv := httptest.NewServer(NewRouter(newLibrary(), t.TempDir(), compDir, t.TempDir()))
	defer srv.Close()

	resp, err := http.Post(srv.URL+"/api/v1/components", "application/json",
		body(t, map[string]string{"yaml": galPartYAML}))
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("status = %d, want 201", resp.StatusCode)
	}
	var created struct {
		Component ComponentType `json:"component"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&created); err != nil {
		t.Fatal(err)
	}
	if created.Component.PartNumber != "PC-DECODE-A" {
		t.Fatalf("component.partnumber = %q, want PC-DECODE-A", created.Component.PartNumber)
	}

	if _, err := os.Stat(filepath.Join(compDir, "PC-DECODE-A.yaml")); err != nil {
		t.Fatalf("expected written YAML: %v", err)
	}

	got, err := http.Get(srv.URL + "/api/v1/components")
	if err != nil {
		t.Fatal(err)
	}
	defer got.Body.Close()
	var list struct {
		Components []ComponentType `json:"components"`
	}
	if err := json.NewDecoder(got.Body).Decode(&list); err != nil {
		t.Fatal(err)
	}
	if len(list.Components) != 1 || list.Components[0].Key() != "PC-DECODE-A" {
		t.Fatalf("created part not in library listing: %+v", list.Components)
	}
}

// Re-creating the same part number is a 409 (FR-007a).
func TestCreateComponentDuplicate(t *testing.T) {
	srv := httptest.NewServer(NewRouter(newLibrary(), t.TempDir(), t.TempDir(), t.TempDir()))
	defer srv.Close()

	post := func() int {
		resp, err := http.Post(srv.URL+"/api/v1/components", "application/json",
			body(t, map[string]string{"yaml": galPartYAML}))
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
		return resp.StatusCode
	}
	if s := post(); s != http.StatusCreated {
		t.Fatalf("first create status = %d, want 201", s)
	}
	if s := post(); s != http.StatusConflict {
		t.Fatalf("duplicate create status = %d, want 409", s)
	}
}

// Invalid submitted YAML (here: a gal part missing its partnumber) is a 400.
func TestCreateComponentInvalid(t *testing.T) {
	srv := httptest.NewServer(NewRouter(newLibrary(), t.TempDir(), t.TempDir(), t.TempDir()))
	defer srv.Close()

	bad := "type: \"22V10\"\ngal: GAL22V10\npins:\n  - { name: I0, side: left, pos: 1, dir: in }\n"
	resp, err := http.Post(srv.URL+"/api/v1/components", "application/json",
		body(t, map[string]string{"yaml": bad}))
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", resp.StatusCode)
	}
}

// body marshals v to JSON and returns it as a request body reader.
func body(t *testing.T, v any) *bytes.Reader {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	return bytes.NewReader(b)
}

// Non-API paths are served from the static web directory.
func TestStaticServesIndex(t *testing.T) {
	webDir := t.TempDir()
	if err := os.WriteFile(filepath.Join(webDir, "index.html"),
		[]byte("<!doctype html><title>retrosim</title>"), 0o644); err != nil {
		t.Fatal(err)
	}

	srv := httptest.NewServer(NewRouter(testLibrary(), t.TempDir(), t.TempDir(), webDir))
	defer srv.Close()

	resp, err := http.Get(srv.URL + "/")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}
}
