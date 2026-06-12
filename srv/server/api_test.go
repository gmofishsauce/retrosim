package server

import (
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
	srv := httptest.NewServer(NewRouter(testLibrary(), t.TempDir(), t.TempDir()))
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
	srv := httptest.NewServer(NewRouter(testLibrary(), t.TempDir(), t.TempDir()))
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
	srv := httptest.NewServer(NewRouter(testLibrary(), t.TempDir(), t.TempDir()))
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

// A non-GET method on the components endpoint is rejected with a JSON envelope.
func TestComponentsMethodNotAllowed(t *testing.T) {
	srv := httptest.NewServer(NewRouter(testLibrary(), t.TempDir(), t.TempDir()))
	defer srv.Close()

	resp, err := http.Post(srv.URL+"/api/v1/components", "application/json", nil)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusMethodNotAllowed {
		t.Fatalf("status = %d, want 405", resp.StatusCode)
	}
}

// Non-API paths are served from the static web directory.
func TestStaticServesIndex(t *testing.T) {
	webDir := t.TempDir()
	if err := os.WriteFile(filepath.Join(webDir, "index.html"),
		[]byte("<!doctype html><title>wut4</title>"), 0o644); err != nil {
		t.Fatal(err)
	}

	srv := httptest.NewServer(NewRouter(testLibrary(), t.TempDir(), webDir))
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
