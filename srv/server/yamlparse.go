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

// validRenderAs is the schematic-symbol set for subunit components (FR-013b).
var validRenderAs = map[string]bool{
	"nand": true, "and": true, "or": true, "nor": true, "xor": true, "xnor": true,
	"not": true, "mux2": true, "mux4": true, "mux8": true,
}

// muxArity gives the required (data, select) input counts per multiplexer symbol;
// data inputs enter on the left, selects on the top (FR-013b).
var muxArity = map[string]struct{ data, sel int }{
	"mux2": {2, 1}, "mux4": {4, 2}, "mux8": {8, 3},
}

// yamlComponent is the on-disk shape (§7.6), decoded before mapping onto
// ComponentType. pos is a pointer so an omitted (required) pos is distinguishable
// from a legitimate 0.
type yamlComponent struct {
	Type       string             `yaml:"type"`
	RenderType string             `yaml:"rendertype"`
	NumUnits   int                `yaml:"numunits"`
	RenderAs   string             `yaml:"renderas"`
	Outline    []int              `yaml:"outline"`
	Pins       []yamlPin          `yaml:"pins"`
	Groups     []yamlGroup        `yaml:"groups"`
	Delays     map[string]float64 `yaml:"delays"`
	Behavior   string             `yaml:"behavior"`
}

type yamlPin struct {
	Name   string `yaml:"name"`
	Side   string `yaml:"side"`
	Pos    *int   `yaml:"pos"`
	Unit   string `yaml:"unit"`
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

	renderType := doc.RenderType
	if renderType == "" {
		renderType = "unit"
	}
	if renderType != "unit" && renderType != "subunit" {
		return ComponentType{}, fmt.Errorf("%s: invalid rendertype %q (want unit|subunit)", path, renderType)
	}
	subunit := renderType == "subunit"

	pinNames := make(map[string]bool, len(doc.Pins))
	pins := make([]Pin, 0, len(doc.Pins))
	for i, p := range doc.Pins {
		if p.Name == "" {
			return ComponentType{}, fmt.Errorf("%s: pin %d: missing 'name'", path, i)
		}
		if !validSides[p.Side] {
			return ComponentType{}, fmt.Errorf("%s: pin %q: invalid side %q (want left|right|top|bottom)", path, p.Name, p.Side)
		}
		if !validDirs[p.Dir] {
			return ComponentType{}, fmt.Errorf("%s: pin %q: invalid dir %q (want in|out|bidir|tristate)", path, p.Name, p.Dir)
		}
		var pos int
		if subunit {
			// pos is dictated by the symbol and ignored; the unit assigns the pin
			// to a functional unit instead (FR-014a, §6.3).
			if p.Unit == "" {
				return ComponentType{}, fmt.Errorf("%s: pin %q: missing 'unit' (required for rendertype: subunit)", path, p.Name)
			}
		} else {
			if p.Pos == nil {
				return ComponentType{}, fmt.Errorf("%s: pin %q: missing 'pos'", path, p.Name)
			}
			if *p.Pos < 0 {
				return ComponentType{}, fmt.Errorf("%s: pin %q: pos %d must be >= 0", path, p.Name, *p.Pos)
			}
			pos = *p.Pos
		}
		pinNames[p.Name] = true
		pins = append(pins, Pin{
			Name:      p.Name,
			Side:      p.Side,
			Position:  pos,
			Unit:      p.Unit,
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

	if subunit {
		if err := validateSubunit(path, doc.RenderAs, doc.NumUnits, pins); err != nil {
			return ComponentType{}, err
		}
		// Outline/width/height are unused for subunits; the client symbol module
		// (§6.8a) owns each unit's footprint and pin positions.
		return ComponentType{
			Name:       doc.Type,
			RenderType: "subunit",
			NumUnits:   doc.NumUnits,
			RenderAs:   doc.RenderAs,
			Pins:       pins,
			PinGroups:  groups,
			Delays:     doc.Delays,
			Behavior:   doc.Behavior,
		}, nil
	}

	width, height, err := resolveOutline(doc.Outline, pins)
	if err != nil {
		return ComponentType{}, fmt.Errorf("%s: %w", path, err)
	}

	return ComponentType{
		Name:       doc.Type,
		RenderType: "unit",
		Width:      width,
		Height:     height,
		Pins:       pins,
		PinGroups:  groups,
		Delays:     doc.Delays,
		Behavior:   doc.Behavior,
	}, nil
}

// validateSubunit checks a subunit package's symbol, unit count, and per-unit pin
// arity (FR-062c, FR-013b, §6.3). Each unit must have exactly one output; gate
// units need ≥1 input (not = exactly 1); mux units need the symbol's data inputs
// on the left and select inputs on the top.
func validateSubunit(path, renderAs string, numUnits int, pins []Pin) error {
	if !validRenderAs[renderAs] {
		return fmt.Errorf("%s: invalid renderas %q for subunit (want nand|and|or|nor|xor|xnor|not|mux2|mux4|mux8)", path, renderAs)
	}
	if numUnits <= 0 {
		return fmt.Errorf("%s: subunit requires numunits > 0, got %d", path, numUnits)
	}

	byUnit := make(map[string][]Pin)
	var order []string
	for _, p := range pins {
		if _, seen := byUnit[p.Unit]; !seen {
			order = append(order, p.Unit)
		}
		byUnit[p.Unit] = append(byUnit[p.Unit], p)
	}
	if len(byUnit) != numUnits {
		return fmt.Errorf("%s: numunits is %d but pins define %d distinct units", path, numUnits, len(byUnit))
	}

	for _, u := range order {
		if err := validateUnitArity(path, renderAs, u, byUnit[u]); err != nil {
			return err
		}
	}
	return nil
}

// validateUnitArity enforces the input/output counts of one unit against its
// symbol. Outputs are out/bidir/tristate pins; inputs are `in` pins.
func validateUnitArity(path, renderAs, unit string, pins []Pin) error {
	outputs, inputs, leftIn, topIn := 0, 0, 0, 0
	for _, p := range pins {
		if p.Direction == "in" {
			inputs++
			switch p.Side {
			case "left":
				leftIn++
			case "top":
				topIn++
			}
		} else {
			outputs++
		}
	}
	if outputs != 1 {
		return fmt.Errorf("%s: unit %q (%s): want exactly 1 output, got %d", path, unit, renderAs, outputs)
	}
	if mux, ok := muxArity[renderAs]; ok {
		if leftIn != mux.data || topIn != mux.sel {
			return fmt.Errorf("%s: unit %q (%s): want %d data inputs (side left) and %d select inputs (side top), got %d and %d",
				path, unit, renderAs, mux.data, mux.sel, leftIn, topIn)
		}
		return nil
	}
	if renderAs == "not" {
		if inputs != 1 {
			return fmt.Errorf("%s: unit %q (not): want exactly 1 input, got %d", path, unit, inputs)
		}
		return nil
	}
	if inputs < 1 {
		return fmt.Errorf("%s: unit %q (%s): want at least 1 input, got %d", path, unit, renderAs, inputs)
	}
	return nil
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
