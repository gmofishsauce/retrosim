package server

// yamlparse.go converts one component-definition YAML file (design §7.6) into a
// ComponentType (§7.1). It decodes with gopkg.in/yaml.v3 (YAML 1.2 core schema,
// so single-letter scalars like N/Y stay strings), ignores unknown keys so the
// format stays additive (FR-066), captures behavioral content verbatim, and
// validates the structural fields (§6.3).

import (
	"fmt"
	"os"

	"gopkg.in/yaml.v3"
)

// Outline derivation constants (§6.3): when a file omits an explicit outline, the
// rectangle is sized to fit the author-placed pins plus a margin, with a floor so
// a side carrying no pins still gets a reasonable extent.
const (
	outlineMargin = 2
	minOutlineDim = 4
)

var validSides = map[string]bool{"left": true, "right": true, "top": true, "bottom": true}
var validDirs = map[string]bool{"in": true, "out": true, "bidir": true, "tristate": true}

// yamlComponent is the on-disk shape (§7.6), decoded before mapping onto
// ComponentType. pos is a pointer so an omitted (required) pos is distinguishable
// from a legitimate 0.
type yamlComponent struct {
	Type     string             `yaml:"type"`
	Outline  []int              `yaml:"outline"`
	Pins     []yamlPin          `yaml:"pins"`
	Groups   []yamlGroup        `yaml:"groups"`
	Delays   map[string]float64 `yaml:"delays"`
	Behavior string             `yaml:"behavior"`
}

type yamlPin struct {
	Name   string `yaml:"name"`
	Side   string `yaml:"side"`
	Pos    *int   `yaml:"pos"`
	Dir    string `yaml:"dir"`
	Number *int   `yaml:"number"`
}

type yamlGroup struct {
	Name string   `yaml:"name"`
	Pins []string `yaml:"pins"`
}

// ParseComponent reads and parses one *.yaml component-definition file (§6.3).
// It returns a fully populated ComponentType (concrete outline resolved) or an
// error naming the file and reason. It never panics.
func ParseComponent(path string) (ComponentType, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return ComponentType{}, fmt.Errorf("%s: %w", path, err)
	}

	var doc yamlComponent
	if err := yaml.Unmarshal(data, &doc); err != nil {
		return ComponentType{}, fmt.Errorf("%s: %w", path, err)
	}

	if doc.Type == "" {
		return ComponentType{}, fmt.Errorf("%s: missing required field 'type' (quote all-digit names, e.g. \"74138\")", path)
	}

	pinNames := make(map[string]bool, len(doc.Pins))
	pins := make([]Pin, 0, len(doc.Pins))
	for i, p := range doc.Pins {
		if p.Name == "" {
			return ComponentType{}, fmt.Errorf("%s: pin %d: missing 'name'", path, i)
		}
		if !validSides[p.Side] {
			return ComponentType{}, fmt.Errorf("%s: pin %q: invalid side %q (want left|right|top|bottom)", path, p.Name, p.Side)
		}
		if p.Pos == nil {
			return ComponentType{}, fmt.Errorf("%s: pin %q: missing 'pos'", path, p.Name)
		}
		if *p.Pos < 0 {
			return ComponentType{}, fmt.Errorf("%s: pin %q: pos %d must be >= 0", path, p.Name, *p.Pos)
		}
		if !validDirs[p.Dir] {
			return ComponentType{}, fmt.Errorf("%s: pin %q: invalid dir %q (want in|out|bidir|tristate)", path, p.Name, p.Dir)
		}
		pinNames[p.Name] = true
		pins = append(pins, Pin{
			Name:      p.Name,
			Side:      p.Side,
			Position:  *p.Pos,
			Direction: p.Dir,
			Number:    p.Number,
		})
	}

	var groups []PinGroup
	for _, g := range doc.Groups {
		for _, member := range g.Pins {
			if !pinNames[member] {
				return ComponentType{}, fmt.Errorf("%s: group %q names unknown pin %q", path, g.Name, member)
			}
		}
		groups = append(groups, PinGroup{Name: g.Name, Pins: g.Pins})
	}

	width, height, err := resolveOutline(doc.Outline, pins)
	if err != nil {
		return ComponentType{}, fmt.Errorf("%s: %w", path, err)
	}

	return ComponentType{
		Name:      doc.Type,
		Width:     width,
		Height:    height,
		Pins:      pins,
		PinGroups: groups,
		Delays:    doc.Delays,
		Behavior:  doc.Behavior,
	}, nil
}

// resolveOutline returns concrete outline dimensions (§6.3): an explicit
// outline: [w, h] if given (validated > 0), else a rectangle derived to fit the
// pins. Left/right pins lie along the vertical sides (constraining height);
// top/bottom pins lie along the horizontal sides (constraining width).
func resolveOutline(outline []int, pins []Pin) (int, int, error) {
	if outline != nil {
		if len(outline) != 2 {
			return 0, 0, fmt.Errorf("outline must be [width, height], got %d values", len(outline))
		}
		if outline[0] <= 0 || outline[1] <= 0 {
			return 0, 0, fmt.Errorf("outline dimensions must be > 0, got [%d, %d]", outline[0], outline[1])
		}
		return outline[0], outline[1], nil
	}

	maxTB, maxLR := 0, 0
	for _, p := range pins {
		switch p.Side {
		case "top", "bottom":
			if p.Position > maxTB {
				maxTB = p.Position
			}
		case "left", "right":
			if p.Position > maxLR {
				maxLR = p.Position
			}
		}
	}
	width := maxTB + outlineMargin
	if width < minOutlineDim {
		width = minOutlineDim
	}
	height := maxLR + outlineMargin
	if height < minOutlineDim {
		height = minOutlineDim
	}
	return width, height, nil
}
