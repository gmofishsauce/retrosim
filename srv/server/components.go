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

// ErrDuplicateComponent reports a create whose part number (or derived filename)
// already exists in the library (FR-007a) — mapped to HTTP 409 by the API.
var ErrDuplicateComponent = errors.New("component already exists")

// ErrComponentWrite reports a server-side failure persisting a created component
// (disk error) — mapped to HTTP 500. Validation failures are not this error.
var ErrComponentWrite = errors.New("component write failed")

// Library holds the parsed component types, keyed by library identity — the type
// name for 74-series parts, the part number for GAL parts (ComponentType.Key,
// FR-066b). Built once at startup (FR-007), then extended only by in-app create
// (FR-007a, §6.4). The mutex guards the map against concurrent create vs. the
// /components reads served from other goroutines.
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
// library key) for the palette (FR-005, FR-006, §6.2). GAL parts of one family
// share a Name, so the key (part number) is the stable sort field.
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

// Create validates submitted component YAML, writes it into dir under a filename
// derived from the part number, and adds the parsed type to the live library
// (FR-007a). It is the in-app authoring path for GAL parts (FR-066c): a created
// part must carry a part number, and a duplicate part number (or a filename
// collision) is refused with ErrDuplicateComponent. The YAML is stored verbatim.
func (l *Library) Create(dir string, yamlText []byte) (ComponentType, error) {
	t, err := ParseComponentBytes(yamlText, "(submitted)")
	if err != nil {
		return ComponentType{}, err
	}
	if t.PartNumber == "" {
		return ComponentType{}, fmt.Errorf("a created part requires a 'partnumber' (set 'gal:' and 'partnumber:')")
	}
	fname, err := componentFileName(t.PartNumber)
	if err != nil {
		return ComponentType{}, err
	}
	path := filepath.Join(dir, fname)

	l.mu.Lock()
	defer l.mu.Unlock()
	if _, ok := l.types[t.Key()]; ok {
		return ComponentType{}, fmt.Errorf("%w: part number %q", ErrDuplicateComponent, t.PartNumber)
	}
	if _, err := os.Stat(path); err == nil {
		return ComponentType{}, fmt.Errorf("%w: file %s", ErrDuplicateComponent, fname)
	} else if !os.IsNotExist(err) {
		return ComponentType{}, fmt.Errorf("%w: %v", ErrComponentWrite, err)
	}
	if err := atomicWrite(path, yamlText); err != nil {
		return ComponentType{}, fmt.Errorf("%w: %v", ErrComponentWrite, err)
	}
	l.types[t.Key()] = t
	return t, nil
}

// componentFileName derives a filename-safe stem from a part number (FR-007a):
// it keeps letters, digits, '.', '_' and '-', collapsing any run of other
// characters to a single '-'. The library key remains the exact part number;
// this only names the on-disk file. An empty result (no safe characters) is an
// error.
func componentFileName(partNumber string) (string, error) {
	var b strings.Builder
	prevDash := false
	for _, r := range partNumber {
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
		return "", fmt.Errorf("part number %q has no filename-safe characters", partNumber)
	}
	return name + ".yaml", nil
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
