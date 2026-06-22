package server

import (
	"reflect"
	"testing"
)

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
