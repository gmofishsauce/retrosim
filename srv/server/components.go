package server

import (
	"errors"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
)

// ErrDuplicateComponent reports a create whose id (or derived filename) already
// exists in the library (FR-007a/FR-066e) — mapped to HTTP 409 by the API.
var ErrDuplicateComponent = errors.New("component already exists")

// ErrComponentWrite reports a server-side failure persisting a created component
// (disk error) — mapped to HTTP 500. Validation failures are not this error.
var ErrComponentWrite = errors.New("component write failed")

// Library holds the parsed component types, keyed by library identity — the
// type's immutable id (ComponentType.Key/ID, FR-066e), divorced from its
// free-form display name. This holds the read-only shared library, built once at
// startup (FR-007) and never mutated thereafter: an in-app create is project-local
// and is written to disk, not added here (FR-121i). The mutex guards the map
// against concurrent reads served from other goroutines.
type Library struct {
	mu    sync.RWMutex
	types map[string]ComponentType
}

// newLibrary returns an empty Library.
func newLibrary() *Library {
	return &Library{types: make(map[string]ComponentType)}
}

// add inserts a component type, keyed by its library identity (Key). A duplicate
// key replaces the earlier one (last-wins, §6.2).
func (l *Library) add(t ComponentType) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.types[t.Key()] = t
}

// has reports whether a component with the given library key is present (§6.2).
func (l *Library) has(key string) bool {
	l.mu.RLock()
	defer l.mu.RUnlock()
	_, ok := l.types[key]
	return ok
}

// List returns all component types in a stable, deterministic order (sorted by
// library key/id) for the palette (FR-005, FR-006, §6.2). GAL parts of one family
// share a Name, so the key (id) is the stable sort field.
func (l *Library) List() []ComponentType {
	l.mu.RLock()
	defer l.mu.RUnlock()
	out := make([]ComponentType, 0, len(l.types))
	for _, t := range l.types {
		out = append(out, t)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Key() < out[j].Key() })
	return out
}

// Create validates submitted component YAML and writes it into the current
// project's components/ subdirectory (FR-007a/FR-121i), returning the parsed type
// so the client can add the tile live. It is the in-app authoring path for GAL
// parts (FR-066c) and generated memory devices (FR-114f): a created part must
// carry an authored marker (a partnumber, or a mem block). The server stays
// stateless — the created part is project-local and is NOT added to the in-memory
// shared library; the client library is the shared ∪ project merge, refreshed on
// project switch and Refresh Types (FR-121i). Creation only, never overwrite: the
// id, or its derived filename, must not collide with an existing part in either
// the project's components/ or the global shared library (sharedDir), else
// ErrDuplicateComponent. The YAML is stored verbatim.
func (l *Library) Create(projectDir, sharedDir string, yamlText []byte) (ComponentType, error) {
	t, err := ParseComponentBytes(yamlText, "(submitted)")
	if err != nil {
		return ComponentType{}, err
	}
	// A created part must be identifiably authored (FR-007a): a GAL part carries a
	// partnumber (FR-066b); a generated memory device carries a mem block (FR-114f).
	if t.PartNumber == "" && t.Mem == nil {
		return ComponentType{}, fmt.Errorf("a created part requires a 'partnumber' (a GAL part) or a 'mem' block (a memory device)")
	}
	fname, err := componentFileName(t.ID)
	if err != nil {
		return ComponentType{}, err
	}
	compDir := filepath.Join(projectDir, "components")

	// Reject an id colliding with the shared library (in memory, keyed by id) or
	// with an existing project-local type (FR-121i: a project part may neither
	// duplicate nor shadow a shared one).
	if l.has(t.Key()) {
		return ComponentType{}, fmt.Errorf("%w: id %q (shared library)", ErrDuplicateComponent, t.ID)
	}
	projTypes, _ := ScanProjectComponents(projectDir)
	for _, pt := range projTypes {
		if pt.Key() == t.Key() {
			return ComponentType{}, fmt.Errorf("%w: id %q (project)", ErrDuplicateComponent, t.ID)
		}
	}
	// Reject a derived filename that already names a file in either scope.
	for _, p := range []string{filepath.Join(compDir, fname), filepath.Join(sharedDir, fname)} {
		if _, err := os.Stat(p); err == nil {
			return ComponentType{}, fmt.Errorf("%w: file %s", ErrDuplicateComponent, fname)
		} else if !os.IsNotExist(err) {
			return ComponentType{}, fmt.Errorf("%w: %v", ErrComponentWrite, err)
		}
	}
	if err := os.MkdirAll(compDir, 0o755); err != nil {
		return ComponentType{}, fmt.Errorf("%w: %v", ErrComponentWrite, err)
	}
	if err := atomicWrite(filepath.Join(compDir, fname), yamlText); err != nil {
		return ComponentType{}, fmt.Errorf("%w: %v", ErrComponentWrite, err)
	}
	return t, nil
}

// componentFileName derives a filename-safe stem from a type's id (FR-007a/
// FR-066e): it keeps letters, digits, '.', '_' and '-', collapsing any run of
// other characters to a single '-'. The library key remains the exact id; this
// only names the on-disk file. An empty result (no safe characters) is an error.
func componentFileName(id string) (string, error) {
	var b strings.Builder
	prevDash := false
	for _, r := range id {
		switch {
		case r >= 'A' && r <= 'Z', r >= 'a' && r <= 'z', r >= '0' && r <= '9', r == '.', r == '_', r == '-':
			b.WriteRune(r)
			prevDash = false
		default:
			if !prevDash {
				b.WriteByte('-')
				prevDash = true
			}
		}
	}
	name := strings.Trim(b.String(), "-.")
	if name == "" {
		return "", fmt.Errorf("id %q has no filename-safe characters", id)
	}
	return name + ".yaml", nil
}

// LoadLibrary reads every *.yaml file in dir (non-recursive), parses each into a
// ComponentType (§6.2/§6.3), and collects them keyed by type id. A single
// file's parse error is logged and skipped, not fatal. A missing directory is
// treated as an empty library (warn, empty palette — §6.1); LoadLibrary returns
// an error only when the directory exists but cannot be read.
func LoadLibrary(dir string) (*Library, error) {
	lib := newLibrary()
	entries, err := os.ReadDir(dir)
	if err != nil {
		if os.IsNotExist(err) {
			log.Printf("retrosim: component dir %q not found; serving empty palette", dir)
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
			log.Printf("retrosim: skipping %s: %v", e.Name(), err)
			continue
		}
		lib.add(t)
	}
	return lib, nil
}

// ScanProjectComponents reads the current project's components/ subdirectory
// (FR-121i) and returns its project-local component types (sorted by id) plus a
// per-file warning for each skipped file: a parse failure, or a duplicate id
// (last wins). It mirrors LoadLibrary's walk but surfaces the warnings for the
// message tray (FR-074) instead of only logging them. A missing components/ dir
// is not an error — it yields no types and no warnings. The server holds no
// project state, so the API re-invokes this per request (FR-121) and merges the
// result over the shared library (MergedList).
func ScanProjectComponents(projectDir string) ([]ComponentType, []string) {
	dir := filepath.Join(projectDir, "components")
	entries, err := os.ReadDir(dir)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, []string{fmt.Sprintf("cannot read %s: %v", dir, err)}
	}
	types := map[string]ComponentType{}
	var warnings []string
	for _, e := range entries {
		if e.IsDir() || filepath.Ext(e.Name()) != ".yaml" {
			continue
		}
		t, err := ParseComponent(filepath.Join(dir, e.Name()))
		if err != nil {
			warnings = append(warnings, fmt.Sprintf("skipping %s: %v", e.Name(), err))
			continue
		}
		if _, dup := types[t.Key()]; dup {
			warnings = append(warnings, fmt.Sprintf("%s: duplicate id %q (last wins)", e.Name(), t.ID))
		}
		types[t.Key()] = t
	}
	out := make([]ComponentType, 0, len(types))
	for _, t := range types {
		out = append(out, t)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Key() < out[j].Key() })
	return out, warnings
}

// MergedList composes the shared library with the given project-local types —
// shared ∪ project (FR-121i) — returning the union sorted by id for the palette
// (FR-006), plus a warning for any project type skipped because its id collides
// with a shared type. The shared part always wins, so a project part can neither
// duplicate nor silently shadow a shared one (in-app creates already refuse such a
// collision, FR-007a).
func (l *Library) MergedList(projectTypes []ComponentType) ([]ComponentType, []string) {
	out := l.List()
	var warnings []string
	for _, t := range projectTypes {
		if l.has(t.Key()) {
			warnings = append(warnings, fmt.Sprintf("project component %q shadows a shared library type; skipped", t.ID))
			continue
		}
		out = append(out, t)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Key() < out[j].Key() })
	return out, warnings
}
