package server

import (
	"reflect"
	"testing"
)

// List returns component types sorted by name (FR-005/FR-006 palette order, §6.2).
func TestLibraryListSortedByName(t *testing.T) {
	lib := newLibrary()
	lib.add(ComponentType{Name: "74138"})
	lib.add(ComponentType{Name: "7400"})
	lib.add(ComponentType{Name: "74244"})

	got := names(lib.List())
	want := []string{"7400", "74138", "74244"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("List() order = %v, want %v", got, want)
	}
}

// A duplicate type name keeps the last one added (last-wins, §6.2).
func TestLibraryDuplicateLastWins(t *testing.T) {
	lib := newLibrary()
	lib.add(ComponentType{Name: "7400", Width: 1})
	lib.add(ComponentType{Name: "7400", Width: 9})

	got := lib.List()
	if len(got) != 1 {
		t.Fatalf("List() len = %d, want 1", len(got))
	}
	if got[0].Width != 9 {
		t.Fatalf("duplicate not last-wins: Width = %d, want 9", got[0].Width)
	}
}

func names(types []ComponentType) []string {
	out := make([]string, len(types))
	for i, t := range types {
		out[i] = t.Name
	}
	return out
}
