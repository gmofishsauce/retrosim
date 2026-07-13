package server

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"testing"
)

func testLibrary() *Library {
	lib := newLibrary()
	lib.add(ComponentType{ID: "type-7400", Name: "7400"})
	lib.add(ComponentType{ID: "type-74138", Name: "74138"})
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

// A generated memory device carries a mem block instead of a partnumber (FR-114f).
const memDeviceYAML = `id: "type-PROGRAM_RAM"
type: "PROGRAM_RAM"
description: "256x8 RAM (generated)"
mem: { kind: ram, addressBits: 8, dataWidth: 8, locations: 256 }
outline: [4, 13]
pins:
  - { name: A0, side: left, pos: 1, dir: in }
  - { name: D0, side: right, pos: 1, dir: bidir }
groups:
  - { name: ADDR, pins: [A0] }
  - { name: DATA, pins: [D0] }
`

// POST /api/v1/components creates a part: 201 + the component, the YAML written
// into the current project's components/ subdir under the part-number filename,
// and the part visible to a following project-scoped GET — all without restart
// (FR-007a/FR-121i).
func TestCreateComponent(t *testing.T) {
	compDir := t.TempDir() // shared library dir
	proj := t.TempDir()    // current project dir
	srv := httptest.NewServer(NewRouter(newLibrary(), t.TempDir(), compDir, t.TempDir()))
	defer srv.Close()

	resp, err := http.Post(srv.URL+"/api/v1/components", "application/json",
		body(t, map[string]string{"yaml": galPartYAML, "project": proj}))
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

	// Written under the project's components/ subdir (FR-121i), not the shared dir.
	if _, err := os.Stat(filepath.Join(proj, "components", "type-PC-DECODE-A.yaml")); err != nil {
		t.Fatalf("expected written YAML under project components/: %v", err)
	}

	got, err := http.Get(srv.URL + "/api/v1/components?project=" + url.QueryEscape(proj))
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
	if len(list.Components) != 1 || list.Components[0].Key() != "type-PC-DECODE-A" {
		t.Fatalf("created part not in project-scoped listing: %+v", list.Components)
	}
}

// Re-creating the same part number in the same project is a 409 (FR-007a).
func TestCreateComponentDuplicate(t *testing.T) {
	proj := t.TempDir()
	srv := httptest.NewServer(NewRouter(newLibrary(), t.TempDir(), t.TempDir(), t.TempDir()))
	defer srv.Close()

	post := func() int {
		resp, err := http.Post(srv.URL+"/api/v1/components", "application/json",
			body(t, map[string]string{"yaml": galPartYAML, "project": proj}))
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
		body(t, map[string]string{"yaml": bad, "project": t.TempDir()}))
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", resp.StatusCode)
	}
}

// A create whose id already exists in the shared library is refused (409), even
// with an empty project components/ — the dual-scope collision (FR-121i).
func TestCreateComponentSharedCollision(t *testing.T) {
	shared := newLibrary()
	shared.add(ComponentType{ID: "type-PC-DECODE-A", Name: "22V10", PartNumber: "PC-DECODE-A", Gal: "GAL22V10"})
	srv := httptest.NewServer(NewRouter(shared, t.TempDir(), t.TempDir(), t.TempDir()))
	defer srv.Close()

	resp, err := http.Post(srv.URL+"/api/v1/components", "application/json",
		body(t, map[string]string{"yaml": galPartYAML, "project": t.TempDir()}))
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusConflict {
		t.Fatalf("shared-collision create status = %d, want 409", resp.StatusCode)
	}
}

// A create with no project directory is a 400 (FR-121i).
func TestCreateComponentMissingProject(t *testing.T) {
	srv := httptest.NewServer(NewRouter(newLibrary(), t.TempDir(), t.TempDir(), t.TempDir()))
	defer srv.Close()

	resp, err := http.Post(srv.URL+"/api/v1/components", "application/json",
		body(t, map[string]string{"yaml": galPartYAML}))
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("missing-project create status = %d, want 400", resp.StatusCode)
	}
}

// A memory device (no partnumber, carries a mem block) creates and round-trips
// its mem block through the library listing (FR-114f).
func TestCreateMemDevice(t *testing.T) {
	proj := t.TempDir()
	srv := httptest.NewServer(NewRouter(newLibrary(), t.TempDir(), t.TempDir(), t.TempDir()))
	defer srv.Close()

	resp, err := http.Post(srv.URL+"/api/v1/components", "application/json",
		body(t, map[string]string{"yaml": memDeviceYAML, "project": proj}))
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("status = %d, want 201", resp.StatusCode)
	}
	if _, err := os.Stat(filepath.Join(proj, "components", "type-PROGRAM_RAM.yaml")); err != nil {
		t.Fatalf("expected written YAML under project components/: %v", err)
	}

	got, err := http.Get(srv.URL + "/api/v1/components?project=" + url.QueryEscape(proj))
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
	if len(list.Components) != 1 || list.Components[0].Mem == nil {
		t.Fatalf("mem device not listed with mem block: %+v", list.Components)
	}
	if m := list.Components[0].Mem; m.Kind != "ram" || m.AddressBits != 8 || m.DataWidth != 8 {
		t.Fatalf("mem round-trip wrong: %+v", m)
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
