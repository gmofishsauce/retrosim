package server

import "sort"

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

// LoadLibrary builds the component library.
//
// The real implementation reads every *.md file in dir and parses it (§6.2/§6.3),
// but the MD file format is still open (OQ-001), so the parser is deferred. Until
// the format session concludes, this returns a small set of hardcoded stub
// component types so the rest of the system can be built and exercised. The dir
// argument is accepted now to keep the signature stable for that swap.
func LoadLibrary(dir string) (*Library, error) {
	_ = dir
	lib := newLibrary()
	for _, t := range stubComponents() {
		lib.add(t)
	}
	return lib, nil
}

// stubComponents returns placeholder component types pending the MD parser
// (OQ-001). Geometry and pins are representative, not authoritative.
func stubComponents() []ComponentType {
	return []ComponentType{
		{
			Name:    "74138",
			Package: "DIP-16",
			Width:   6,
			Height:  12,
			Pins: []Pin{
				{Name: "A0", Side: "left", Position: 2, Direction: "in", Width: 1},
				{Name: "A1", Side: "left", Position: 3, Direction: "in", Width: 1},
				{Name: "A2", Side: "left", Position: 4, Direction: "in", Width: 1},
				{Name: "/E1", Side: "left", Position: 6, Direction: "in", Width: 1},
				{Name: "/E2", Side: "left", Position: 7, Direction: "in", Width: 1},
				{Name: "E3", Side: "left", Position: 8, Direction: "in", Width: 1},
				{Name: "/Y0", Side: "right", Position: 2, Direction: "out", Width: 1},
				{Name: "/Y1", Side: "right", Position: 3, Direction: "out", Width: 1},
				{Name: "/Y2", Side: "right", Position: 4, Direction: "out", Width: 1},
				{Name: "/Y3", Side: "right", Position: 5, Direction: "out", Width: 1},
				{Name: "/Y4", Side: "right", Position: 6, Direction: "out", Width: 1},
				{Name: "/Y5", Side: "right", Position: 7, Direction: "out", Width: 1},
				{Name: "/Y6", Side: "right", Position: 8, Direction: "out", Width: 1},
				{Name: "/Y7", Side: "right", Position: 9, Direction: "out", Width: 1},
				{Name: "GND", Side: "bottom", Position: 3, Direction: "in", Width: 1},
				{Name: "Vcc", Side: "top", Position: 3, Direction: "in", Width: 1},
			},
			PinGroups: []PinGroup{
				{Name: "A", Pins: []string{"A0", "A1", "A2"}},
			},
		},
		{
			Name:    "7400",
			Package: "DIP-14",
			Width:   6,
			Height:  10,
			Pins: []Pin{
				{Name: "1A", Side: "left", Position: 2, Direction: "in", Width: 1},
				{Name: "1B", Side: "left", Position: 3, Direction: "in", Width: 1},
				{Name: "2A", Side: "left", Position: 5, Direction: "in", Width: 1},
				{Name: "2B", Side: "left", Position: 6, Direction: "in", Width: 1},
				{Name: "1Y", Side: "right", Position: 2, Direction: "out", Width: 1},
				{Name: "2Y", Side: "right", Position: 5, Direction: "out", Width: 1},
				{Name: "GND", Side: "bottom", Position: 3, Direction: "in", Width: 1},
				{Name: "Vcc", Side: "top", Position: 3, Direction: "in", Width: 1},
			},
		},
	}
}
