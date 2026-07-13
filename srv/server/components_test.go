package server

import (
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

// writeProjectComponent writes YAML into <projectDir>/components/<name>, creating
// the subdir — a fixture helper for the project-scan tests (FR-121i).
func writeProjectComponent(t *testing.T, projectDir, name, yaml string) {
	t.Helper()
	dir := filepath.Join(projectDir, "components")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, name), []byte(yaml), 0o644); err != nil {
		t.Fatal(err)
	}
}

// A missing components/ subdir is not an error: no types, no warnings (FR-121i).
func TestScanProjectComponentsMissing(t *testing.T) {
	types, warnings := ScanProjectComponents(t.TempDir())
	if len(types) != 0 || len(warnings) != 0 {
		t.Fatalf("missing dir: types=%v warnings=%v, want empty", types, warnings)
	}
}

// A present components/ subdir yields its parsed project-local types (FR-121i).
func TestScanProjectComponentsPresent(t *testing.T) {
	proj := t.TempDir()
	writeProjectComponent(t, proj, "type-PC-DECODE-A.yaml", galPartYAML)
	writeProjectComponent(t, proj, "type-PROGRAM_RAM.yaml", memDeviceYAML)

	types, warnings := ScanProjectComponents(proj)
	if len(warnings) != 0 {
		t.Fatalf("unexpected warnings: %v", warnings)
	}
	got := map[string]bool{}
	for _, ct := range types {
		got[ct.Key()] = true
	}
	if !got["type-PC-DECODE-A"] || !got["type-PROGRAM_RAM"] {
		t.Fatalf("scan missing a type: %v", got)
	}
}

// A malformed component file is skipped with a reported warning; the rest load
// (FR-121i/FR-074).
func TestScanProjectComponentsMalformed(t *testing.T) {
	proj := t.TempDir()
	writeProjectComponent(t, proj, "good.yaml", galPartYAML)
	writeProjectComponent(t, proj, "bad.yaml",
		"type: \"BADPART\"\npins:\n  - { name: X, side: sideways, pos: 1, dir: in }\n")

	types, warnings := ScanProjectComponents(proj)
	if len(types) != 1 || types[0].Key() != "type-PC-DECODE-A" {
		t.Fatalf("expected only the good type, got %v", types)
	}
	if len(warnings) != 1 {
		t.Fatalf("expected 1 warning for the malformed file, got %v", warnings)
	}
}

// Two project files sharing an id collapse to one (last wins) with a reported
// collision (FR-121i).
func TestScanProjectComponentsDuplicateID(t *testing.T) {
	proj := t.TempDir()
	writeProjectComponent(t, proj, "a.yaml", galPartYAML)
	writeProjectComponent(t, proj, "b.yaml", galPartYAML)

	types, warnings := ScanProjectComponents(proj)
	if len(types) != 1 {
		t.Fatalf("duplicate id should collapse to one type, got %v", types)
	}
	if len(warnings) != 1 {
		t.Fatalf("expected 1 duplicate warning, got %v", warnings)
	}
}

// MergedList returns shared ∪ project, sorted by id, for the palette (FR-121i).
func TestMergedListUnion(t *testing.T) {
	shared := newLibrary()
	shared.add(ComponentType{ID: "type-7400", Name: "7400"})
	got, warnings := shared.MergedList([]ComponentType{{ID: "type-PC-DECODE-A", Name: "22V10"}})
	if len(warnings) != 0 {
		t.Fatalf("unexpected warnings: %v", warnings)
	}
	var keys []string
	for _, ct := range got {
		keys = append(keys, ct.Key())
	}
	if want := []string{"type-7400", "type-PC-DECODE-A"}; !reflect.DeepEqual(keys, want) {
		t.Fatalf("merged keys = %v, want %v", keys, want)
	}
}

// A project type whose id collides with a shared id is skipped and reported; the
// shared type wins (FR-121i).
func TestMergedListShadowSkipped(t *testing.T) {
	shared := newLibrary()
	shared.add(ComponentType{ID: "type-7400", Name: "7400", Width: 1})
	got, warnings := shared.MergedList([]ComponentType{{ID: "type-7400", Name: "IMPOSTER", Width: 9}})
	if len(got) != 1 || got[0].Name != "7400" {
		t.Fatalf("shared type should win the shadow: %+v", got)
	}
	if len(warnings) != 1 {
		t.Fatalf("expected 1 shadow warning, got %v", warnings)
	}
}

// List returns component types sorted by name (FR-005/FR-006 palette order, §6.2).
func TestLibraryListSortedByName(t *testing.T) {
	lib := newLibrary()
	lib.add(ComponentType{ID: "type-74138", Name: "74138"})
	lib.add(ComponentType{ID: "type-7400", Name: "7400"})
	lib.add(ComponentType{ID: "type-74244", Name: "74244"})

	got := names(lib.List())
	want := []string{"7400", "74138", "74244"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("List() order = %v, want %v", got, want)
	}
}

// A duplicate type name keeps the last one added (last-wins, §6.2).
func TestLibraryDuplicateLastWins(t *testing.T) {
	lib := newLibrary()
	lib.add(ComponentType{ID: "type-7400", Name: "7400", Width: 1})
	lib.add(ComponentType{ID: "type-7400", Name: "7400", Width: 9})

	got := lib.List()
	if len(got) != 1 {
		t.Fatalf("List() len = %d, want 1", len(got))
	}
	if got[0].Width != 9 {
		t.Fatalf("duplicate not last-wins: Width = %d, want 9", got[0].Width)
	}
}

// Two GAL parts of the same device family coexist, keyed by id, not by the shared
// type name (FR-066e). has() recognizes the key for duplicate rejection (FR-007a).
func TestLibraryKeysGalByID(t *testing.T) {
	lib := newLibrary()
	lib.add(ComponentType{ID: "type-PC-DECODE-A", Name: "22V10", Gal: "GAL22V10", PartNumber: "PC-DECODE-A"})
	lib.add(ComponentType{ID: "type-PC-DECODE-B", Name: "22V10", Gal: "GAL22V10", PartNumber: "PC-DECODE-B"})

	got := lib.List()
	if len(got) != 2 {
		t.Fatalf("List() len = %d, want 2 (same family, distinct ids)", len(got))
	}
	if !lib.has("type-PC-DECODE-A") || !lib.has("type-PC-DECODE-B") {
		t.Fatalf("has() missing one of the ids")
	}
	if lib.has("type-22V10") {
		t.Fatalf("has() matched the shared family name; GAL parts key by id")
	}
}

// Every shipped component file in ../components must parse: a parse failure is
// logged and skipped by LoadLibrary, so it would simply be absent here.
func TestShippedComponentsParse(t *testing.T) {
	lib, err := LoadLibrary("../components")
	if err != nil {
		t.Fatalf("LoadLibrary: %v", err)
	}
	got := map[string]bool{}
	for _, c := range lib.List() {
		got[c.Name] = true
	}
	// 74157 and 74283 were re-laid-out so their interleaved buses are contiguous
	// (FR-063a); their presence confirms they still pass the geometry check.
	for _, want := range []string{"7400", "7404", "7432", "74138", "74153", "74157", "74283"} {
		if !got[want] {
			t.Errorf("component %q missing from library (parse error?)", want)
		}
	}
}

func names(types []ComponentType) []string {
	out := make([]string, len(types))
	for i, t := range types {
		out[i] = t.Name
	}
	return out
}
