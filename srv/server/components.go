package server

import (
	"log"
	"os"
	"path/filepath"
	"sort"
)

// Library holds the parsed component types, keyed by type name. It is built once
// at startup (FR-007) and is immutable thereafter (§6.2).
type Library struct {
	types map[string]ComponentType
}

// newLibrary returns an empty Library.
func newLibrary() *Library {
	return &Library{types: make(map[string]ComponentType)}
}

// add inserts a component type. A duplicate type name replaces the earlier one
// (last-wins, §6.2).
func (l *Library) add(t ComponentType) {
	l.types[t.Name] = t
}

// List returns all component types in a stable, deterministic order (sorted by
// name) for the palette (FR-005, FR-006, §6.2).
func (l *Library) List() []ComponentType {
	out := make([]ComponentType, 0, len(l.types))
	for _, t := range l.types {
		out = append(out, t)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out
}

// LoadLibrary reads every *.yaml file in dir (non-recursive), parses each into a
// ComponentType (§6.2/§6.3), and collects them keyed by type name. A single
// file's parse error is logged and skipped, not fatal. A missing directory is
// treated as an empty library (warn, empty palette — §6.1); LoadLibrary returns
// an error only when the directory exists but cannot be read.
func LoadLibrary(dir string) (*Library, error) {
	lib := newLibrary()
	entries, err := os.ReadDir(dir)
	if err != nil {
		if os.IsNotExist(err) {
			log.Printf("wut4-editor: component dir %q not found; serving empty palette", dir)
			return lib, nil
		}
		return nil, err
	}
	for _, e := range entries {
		if e.IsDir() || filepath.Ext(e.Name()) != ".yaml" {
			continue
		}
		t, err := ParseComponent(filepath.Join(dir, e.Name()))
		if err != nil {
			log.Printf("wut4-editor: skipping %s: %v", e.Name(), err)
			continue
		}
		lib.add(t)
	}
	return lib, nil
}
