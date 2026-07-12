package server

import (
	"encoding/json"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// postJSON POSTs body and decodes the JSON response into v.
func postJSON(t *testing.T, url, body string, wantStatus int, v any) {
	t.Helper()
	resp, err := http.Post(url, "application/json", strings.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != wantStatus {
		t.Fatalf("POST %s status = %d, want %d", url, resp.StatusCode, wantStatus)
	}
	if v != nil {
		if err := json.NewDecoder(resp.Body).Decode(v); err != nil {
			t.Fatal(err)
		}
	}
}

// Manifests are excluded from file listings by default (FR-121a) and included
// under manifests=1; exts=- lists directories only (§6.5).
func TestFilesEndpointManifestsAndDirsOnly(t *testing.T) {
	dataDir := t.TempDir()
	mustWrite(t, filepath.Join(dataDir, "a.json"), "{}")
	mustWrite(t, filepath.Join(dataDir, "p-manifest.json"), `{"name":"P"}`)
	if err := os.Mkdir(filepath.Join(dataDir, "sub"), 0o755); err != nil {
		t.Fatal(err)
	}
	srv := newTestServer(t, dataDir)

	var listing DirListing
	getJSON(t, srv.URL+"/api/v1/files", http.StatusOK, &listing)
	names := entryNames(listing)
	if names["p-manifest.json"] {
		t.Errorf("default listing includes the manifest: %v", names)
	}
	if !names["a.json"] || !names["sub"] {
		t.Errorf("default listing missing expected entries: %v", names)
	}

	getJSON(t, srv.URL+"/api/v1/files?manifests=1", http.StatusOK, &listing)
	if !entryNames(listing)["p-manifest.json"] {
		t.Errorf("manifests=1 listing missing the manifest: %v", entryNames(listing))
	}

	getJSON(t, srv.URL+"/api/v1/files?exts=-", http.StatusOK, &listing)
	names = entryNames(listing)
	if names["a.json"] || names["p-manifest.json"] || !names["sub"] {
		t.Errorf("exts=- listing = %v, want directories only", names)
	}
}

func TestProjectInfoEndpoint(t *testing.T) {
	dataDir := t.TempDir()
	mustWrite(t, filepath.Join(dataDir, "proj-manifest.json"),
		`{"formatVersion":1,"name":"My CPU","mainDesign":"cpu.json"}`)
	mustWrite(t, filepath.Join(dataDir, "cpu.json"), "{}")
	srv := newTestServer(t, dataDir)

	var info Info
	getJSON(t, srv.URL+"/api/v1/project/info?dir="+url.QueryEscape(dataDir), http.StatusOK, &info)
	if info.Name != "My CPU" || info.MainDesign != "cpu.json" || info.ManifestFile != "proj-manifest.json" {
		t.Errorf("info = %+v", info)
	}
	if info.Warnings == nil {
		t.Error("warnings is null, want []")
	}

	status(t, srv.URL+"/api/v1/project/info?dir=relative", http.StatusBadRequest)
	status(t, srv.URL+"/api/v1/project/info?dir="+url.QueryEscape(filepath.Join(dataDir, "missing")), http.StatusNotFound)
	status(t, srv.URL+"/api/v1/project/info?dir="+url.QueryEscape(filepath.Join(dataDir, "cpu.json")), http.StatusForbidden)
}

func TestProjectCreateEndpoint(t *testing.T) {
	dataDir := t.TempDir()
	srv := newTestServer(t, dataDir)
	path := filepath.Join(dataDir, "newproj")

	var info Info
	postJSON(t, srv.URL+"/api/v1/project/create",
		`{"path":`+jsonString(path)+`}`, http.StatusCreated, &info)
	if info.Name != "newproj" || info.ManifestFile != "newproj-manifest.json" {
		t.Errorf("info = %+v", info)
	}

	// Existing path → 409; missing parent → 400; bad body → 400.
	postStatus(t, srv.URL+"/api/v1/project/create", `{"path":`+jsonString(path)+`}`, http.StatusConflict)
	postStatus(t, srv.URL+"/api/v1/project/create",
		`{"path":`+jsonString(filepath.Join(dataDir, "no", "such"))+`}`, http.StatusBadRequest)
	postStatus(t, srv.URL+"/api/v1/project/create", `{nope`, http.StatusBadRequest)
}

func TestProjectDuplicateEndpoint(t *testing.T) {
	dataDir := t.TempDir()
	src := filepath.Join(dataDir, "orig")
	if err := os.Mkdir(src, 0o755); err != nil {
		t.Fatal(err)
	}
	mustWrite(t, filepath.Join(src, "orig-manifest.json"), `{"formatVersion":1,"name":"O","mainDesign":"cpu.json"}`)
	mustWrite(t, filepath.Join(src, "cpu.json"), "{}")
	srv := newTestServer(t, dataDir)
	dst := filepath.Join(dataDir, "copy")

	var info Info
	postJSON(t, srv.URL+"/api/v1/project/duplicate",
		`{"src":`+jsonString(src)+`,"dst":`+jsonString(dst)+`}`, http.StatusCreated, &info)
	if info.Name != "copy" || info.MainDesign != "cpu.json" {
		t.Errorf("info = %+v", info)
	}
	if _, err := os.Stat(filepath.Join(dst, "cpu.json")); err != nil {
		t.Errorf("cpu.json not copied: %v", err)
	}

	// Existing dst → 409; missing src → 404.
	postStatus(t, srv.URL+"/api/v1/project/duplicate",
		`{"src":`+jsonString(src)+`,"dst":`+jsonString(dst)+`}`, http.StatusConflict)
	postStatus(t, srv.URL+"/api/v1/project/duplicate",
		`{"src":`+jsonString(filepath.Join(dataDir, "gone"))+`,"dst":`+jsonString(filepath.Join(dataDir, "d2"))+`}`,
		http.StatusNotFound)
}
