package server

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func TestSaveLoadRoundTrip(t *testing.T) {
	path := filepath.Join(t.TempDir(), "design.json")
	want := json.RawMessage(`{"formatVersion":1,"name":"x","components":[]}`)

	if err := SaveDesign(path, want); err != nil {
		t.Fatalf("SaveDesign: %v", err)
	}
	got, err := LoadDesign(path)
	if err != nil {
		t.Fatalf("LoadDesign: %v", err)
	}
	if !jsonEqual(t, got, want) {
		t.Fatalf("round-trip mismatch:\n got %s\nwant %s", got, want)
	}
}

// A failed write must not truncate or corrupt an existing design (atomic
// temp+rename, §6.5).
func TestSaveDesignPreservesExistingOnFailure(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "design.json")
	original := []byte(`{"keep":true}`)
	if err := os.WriteFile(path, original, 0o644); err != nil {
		t.Fatal(err)
	}

	// Make the directory unwritable so the temp file cannot be created.
	if err := os.Chmod(dir, 0o555); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { os.Chmod(dir, 0o755) })

	if err := SaveDesign(path, json.RawMessage(`{"keep":false}`)); err == nil {
		t.Fatal("SaveDesign succeeded into an unwritable dir, want error")
	}

	got, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != string(original) {
		t.Fatalf("existing file changed after failed save: %s", got)
	}
}

func TestSaveDesignRejectsBadPath(t *testing.T) {
	for _, p := range []string{"", "relative/design.json"} {
		if err := SaveDesign(p, json.RawMessage(`{}`)); !errors.Is(err, ErrInvalidPath) {
			t.Fatalf("SaveDesign(%q) err = %v, want ErrInvalidPath", p, err)
		}
	}
}

func TestLoadDesignMalformedJSON(t *testing.T) {
	path := filepath.Join(t.TempDir(), "bad.json")
	if err := os.WriteFile(path, []byte("{not json"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := LoadDesign(path); !errors.Is(err, ErrMalformedJSON) {
		t.Fatalf("LoadDesign err = %v, want ErrMalformedJSON", err)
	}
}

func TestLoadDesignNotFound(t *testing.T) {
	_, err := LoadDesign(filepath.Join(t.TempDir(), "nope.json"))
	if !os.IsNotExist(err) {
		t.Fatalf("LoadDesign err = %v, want IsNotExist", err)
	}
}

func TestListDirFiltersJSONAndDirs(t *testing.T) {
	dir := t.TempDir()
	mustWrite(t, filepath.Join(dir, "a.json"), "{}")
	mustWrite(t, filepath.Join(dir, "b.txt"), "x")
	mustWrite(t, filepath.Join(dir, "c.JSON"), "{}")
	if err := os.Mkdir(filepath.Join(dir, "sub"), 0o755); err != nil {
		t.Fatal(err)
	}

	listing, err := ListDir(dir)
	if err != nil {
		t.Fatalf("ListDir: %v", err)
	}
	if listing.Parent != filepath.Dir(dir) {
		t.Fatalf("Parent = %q, want %q", listing.Parent, filepath.Dir(dir))
	}

	got := map[string]bool{}
	for _, e := range listing.Entries {
		got[e.Name] = e.IsDir
	}
	if _, ok := got["b.txt"]; ok {
		t.Fatal("b.txt should be filtered out")
	}
	if isDir, ok := got["a.json"]; !ok || isDir {
		t.Fatalf("a.json missing or marked dir: %v", got)
	}
	if _, ok := got["c.JSON"]; !ok {
		t.Fatal("c.JSON (case-insensitive) should be included")
	}
	if isDir, ok := got["sub"]; !ok || !isDir {
		t.Fatalf("sub missing or not marked dir: %v", got)
	}
}

func TestListDirNotADir(t *testing.T) {
	path := filepath.Join(t.TempDir(), "f.json")
	mustWrite(t, path, "{}")
	if _, err := ListDir(path); !errors.Is(err, ErrNotDir) {
		t.Fatalf("ListDir(file) err = %v, want ErrNotDir", err)
	}
}

func TestListDirCustomExtensions(t *testing.T) {
	dir := t.TempDir()
	mustWrite(t, filepath.Join(dir, "rom.bin"), "x")
	mustWrite(t, filepath.Join(dir, "font.HEX"), "x")
	mustWrite(t, filepath.Join(dir, "design.json"), "{}")

	// The ROM picker passes bin/hex (no leading dot, mixed case) — JSON omitted.
	listing, err := ListDir(dir, "bin", "hex")
	if err != nil {
		t.Fatalf("ListDir: %v", err)
	}
	got := map[string]bool{}
	for _, e := range listing.Entries {
		got[e.Name] = true
	}
	if !got["rom.bin"] || !got["font.HEX"] {
		t.Fatalf("bin/hex files missing: %v", got)
	}
	if got["design.json"] {
		t.Fatalf("design.json should be filtered out with bin/hex filter: %v", got)
	}
}

func TestReadFileBytes(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "rom.bin")
	mustWrite(t, path, "\x01\x02\x03")
	data, err := ReadFileBytes(path)
	if err != nil {
		t.Fatalf("ReadFileBytes: %v", err)
	}
	if string(data) != "\x01\x02\x03" {
		t.Fatalf("bytes = %v, want 01 02 03", data)
	}
	// A relative path is rejected; a missing file surfaces os.IsNotExist (→ 404).
	if _, err := ReadFileBytes("rom.bin"); !errors.Is(err, ErrInvalidPath) {
		t.Fatalf("relative path err = %v, want ErrInvalidPath", err)
	}
	if _, err := ReadFileBytes(filepath.Join(dir, "nope.bin")); !os.IsNotExist(err) {
		t.Fatalf("missing file err = %v, want IsNotExist", err)
	}
}

func jsonEqual(t *testing.T, a, b []byte) bool {
	t.Helper()
	var x, y any
	if err := json.Unmarshal(a, &x); err != nil {
		t.Fatalf("unmarshal a: %v", err)
	}
	if err := json.Unmarshal(b, &y); err != nil {
		t.Fatalf("unmarshal b: %v", err)
	}
	ab, _ := json.Marshal(x)
	bb, _ := json.Marshal(y)
	return string(ab) == string(bb)
}

func mustWrite(t *testing.T, path, content string) {
	t.Helper()
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}
