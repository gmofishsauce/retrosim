package server

// library_test.go parses every real component-definition file shipped in
// srv/components with the strict ParseComponent path. LoadLibrary (§6.2)
// deliberately log-and-skips a bad file at server startup, so without this
// test a library regression — a duplicate pin number, a physical: block that
// no longer tiles 1..pincount (FR-062e), a malformed group — would only ever
// surface as a silently thinner palette.

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLibraryFilesAllParse(t *testing.T) {
	dir := filepath.Join("..", "components")
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Skipf("component library dir not readable (%v); skipping", err)
	}
	parsed := 0
	for _, e := range entries {
		if e.IsDir() || filepath.Ext(e.Name()) != ".yaml" {
			continue
		}
		if _, err := ParseComponent(filepath.Join(dir, e.Name())); err != nil {
			t.Errorf("library file fails to parse: %v", err)
			continue
		}
		parsed++
	}
	if parsed == 0 {
		t.Fatal("no .yaml files parsed from the component library")
	}
	t.Logf("parsed %d library files", parsed)
}
