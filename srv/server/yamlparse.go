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

// validGalDevices is GALasm's own device set (galasmManual.txt); naming one in
// `gal:` selects strict dialect (FR-066a). The server validates only the name —
// the dialect it selects is enforced client-side at Run (§6.13, FR-079b).
var validGalDevices = map[string]bool{
	"GAL16V8": true, "GAL20V8": true, "GAL22V10": true, "GAL20RA10": true,
}

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
	ID         string             `yaml:"id"`
	Type       string             `yaml:"type"`
	RenderType string             `yaml:"rendertype"`
	NumUnits   int                `yaml:"numunits"`
	RenderAs   string             `yaml:"renderas"`
	Outline    []int              `yaml:"outline"`
	Pins       []yamlPin          `yaml:"pins"`
	Groups     []yamlGroup        `yaml:"groups"`
	Delays     map[string]float64 `yaml:"delays"`
	Behavior   string             `yaml:"behavior"`
	Clock      string             `yaml:"clock"`
	Gal        string             `yaml:"gal"`
	PartNumber string             `yaml:"partnumber"`

	// Documentation (FR-104), all optional.
	Description string         `yaml:"description"`
	Datasheet   *yamlDatasheet `yaml:"datasheet"`
}

type yamlPin struct {
	Name   string `yaml:"name"`
	Side   string `yaml:"side"`
	Pos    *int   `yaml:"pos"`
	Unit   string `yaml:"unit"`
	Dir    string `yaml:"dir"`
	Number *int   `yaml:"number"`
	Desc   string `yaml:"desc"`
}

type yamlDatasheet struct {
	Vendor string `yaml:"vendor"`
	Title  string `yaml:"title"`
	Rev    string `yaml:"rev"`
	URL    string `yaml:"url"`
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
	return ParseComponentBytes(data, path)
}

// ParseComponentBytes parses already-read component YAML with the same validation
// as ParseComponent (§6.3); it backs the in-app create path (FR-007a), whose YAML
// arrives in a request body rather than on disk. The path argument only labels
// error messages (a file path, or a stand-in like "(submitted)").
func ParseComponentBytes(data []byte, path string) (ComponentType, error) {
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
		if pinNames[p.Name] {
			// A duplicate pin name would make saved endpoint references like
			// "U3.A0" ambiguous (§6.3).
			return ComponentType{}, fmt.Errorf("%s: duplicate pin name %q", path, p.Name)
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
			Desc:      p.Desc,
		})
	}

	// clock: must name an existing input pin (FR-062d). Whether the behavior
	// actually requires a clock (uses .R) is checked client-side at Run time
	// (§6.13) — the behavior block is opaque to the server (FR-066).
	if doc.Clock != "" {
		found := false
		for _, p := range pins {
			if p.Name == doc.Clock {
				if p.Direction != "in" {
					return ComponentType{}, fmt.Errorf("%s: clock pin %q must have dir in, got %q", path, doc.Clock, p.Direction)
				}
				found = true
				break
			}
		}
		if !found {
			return ComponentType{}, fmt.Errorf("%s: clock names unknown pin %q", path, doc.Clock)
		}
	}

	// gal: (FR-066a) — validate only the device name; the strict-vs-extended
	// dialect it selects is enforced client-side at Run (§6.13).
	if doc.Gal != "" && !validGalDevices[doc.Gal] {
		return ComponentType{}, fmt.Errorf("%s: gal names unknown device %q (want GAL16V8|GAL20V8|GAL22V10|GAL20RA10)", path, doc.Gal)
	}

	// partnumber: a GAL part (gal set) names a specific programmed part, with type
	// giving only the device family and partnumber the unique identity & library
	// key (FR-066b). The two go together: gal requires a partnumber, and a
	// partnumber is meaningless without gal.
	if doc.Gal != "" && doc.PartNumber == "" {
		return ComponentType{}, fmt.Errorf("%s: a gal part requires a 'partnumber' (the unique part identity; type names only the device family)", path)
	}
	if doc.Gal == "" && doc.PartNumber != "" {
		return ComponentType{}, fmt.Errorf("%s: 'partnumber' is only valid on a gal part (set 'gal:')", path)
	}

	// id (FR-066e) is the immutable library key, divorced from the free-form
	// display name. It is optional in the YAML — when omitted it is derived from
	// the display name so the format stays additive (FR-066) and pre-existing
	// files keep parsing; the library files set it explicitly so renaming the
	// display name never moves the key.
	id := deriveComponentID(doc.ID, doc.PartNumber, doc.Type)

	pinByName := make(map[string]Pin, len(pins))
	for _, p := range pins {
		pinByName[p.Name] = p
	}
	var groups []PinGroup
	groupNames := make(map[string]bool, len(doc.Groups))
	for _, g := range doc.Groups {
		if groupNames[g.Name] {
			return ComponentType{}, fmt.Errorf("%s: duplicate group name %q", path, g.Name)
		}
		groupNames[g.Name] = true
		for _, member := range g.Pins {
			if !pinNames[member] {
				return ComponentType{}, fmt.Errorf("%s: group %q names unknown pin %q", path, g.Name, member)
			}
		}
		if err := validateGroupGeometry(path, g, pins, pinByName, subunit); err != nil {
			return ComponentType{}, err
		}
		groups = append(groups, PinGroup{Name: g.Name, Pins: g.Pins})
	}

	// Documentation (FR-104): presentation-only, copied through verbatim.
	var datasheet *Datasheet
	if d := doc.Datasheet; d != nil {
		datasheet = &Datasheet{Vendor: d.Vendor, Title: d.Title, Rev: d.Rev, URL: d.URL}
	}

	if subunit {
		if err := validateSubunit(path, doc.RenderAs, doc.NumUnits, pins); err != nil {
			return ComponentType{}, err
		}
		// Outline/width/height are unused for subunits; the client symbol module
		// (§6.8a) owns each unit's footprint and pin positions.
		return ComponentType{
			ID:          id,
			Name:        doc.Type,
			RenderType:  "subunit",
			NumUnits:    doc.NumUnits,
			RenderAs:    doc.RenderAs,
			Pins:        pins,
			PinGroups:   groups,
			Delays:      doc.Delays,
			Behavior:    doc.Behavior,
			Clock:       doc.Clock,
			Gal:         doc.Gal,
			PartNumber:  doc.PartNumber,
			Description: doc.Description,
			Datasheet:   datasheet,
		}, nil
	}

	width, height, err := resolveOutline(doc.Outline, pins)
	if err != nil {
		return ComponentType{}, fmt.Errorf("%s: %w", path, err)
	}

	// Every pin must lie within the resolved outline (§6.3); only an explicit
	// outline: smaller than the author-placed pins can violate this — a derived
	// outline is sized to fit.
	for _, p := range pins {
		switch p.Side {
		case "left", "right":
			if p.Position > height {
				return ComponentType{}, fmt.Errorf("%s: pin %q: pos %d exceeds outline height %d", path, p.Name, p.Position, height)
			}
		case "top", "bottom":
			if p.Position > width {
				return ComponentType{}, fmt.Errorf("%s: pin %q: pos %d exceeds outline width %d", path, p.Name, p.Position, width)
			}
		}
	}

	return ComponentType{
		ID:          id,
		Name:        doc.Type,
		RenderType:  "unit",
		Width:       width,
		Height:      height,
		Pins:        pins,
		PinGroups:   groups,
		Delays:      doc.Delays,
		Behavior:    doc.Behavior,
		Clock:       doc.Clock,
		Gal:         doc.Gal,
		PartNumber:  doc.PartNumber,
		Description: doc.Description,
		Datasheet:   datasheet,
	}, nil
}

// deriveComponentID returns the type's immutable library id (FR-066e): the
// explicit `id:` from the YAML if present, else `type-` + the display name (the
// part number for a GAL part, else the type name) — the same rule the client and
// the save-format migration use, so an explicit and a derived id agree for a
// given part. The display name has already been validated non-empty by the time
// this is called, so the derived id is never the bare prefix.
func deriveComponentID(explicit, partNumber, typeName string) string {
	if explicit != "" {
		return explicit
	}
	stem := partNumber
	if stem == "" {
		stem = typeName
	}
	return "type-" + stem
}

// validateGroupGeometry enforces the pin-group geometry rule (FR-063a): a group's
// members must all be on one side, and (for unit components, where `pos` is
// meaningful) form a contiguous run there — no non-member pin may lie between
// them. The bus-snap curly brace (design §6.8/§6.9) assumes members are colinear
// on one edge, so a violating group would render and target incorrectly. `pos` is
// not meaningful for subunit symbols, so contiguity is skipped for them.
func validateGroupGeometry(path string, g yamlGroup, pins []Pin, byName map[string]Pin, subunit bool) error {
	side := byName[g.Pins[0]].Side
	memberPos := make(map[int]bool, len(g.Pins))
	minPos, maxPos := byName[g.Pins[0]].Position, byName[g.Pins[0]].Position
	for _, m := range g.Pins {
		p := byName[m]
		if p.Side != side {
			return fmt.Errorf("%s: group %q has members on different sides (%s and %s); all members must be on one side (FR-063a)", path, g.Name, side, p.Side)
		}
		memberPos[p.Position] = true
		if p.Position < minPos {
			minPos = p.Position
		}
		if p.Position > maxPos {
			maxPos = p.Position
		}
	}
	if subunit {
		return nil
	}
	for _, p := range pins {
		if p.Side == side && p.Position > minPos && p.Position < maxPos && !memberPos[p.Position] {
			return fmt.Errorf("%s: group %q is not contiguous: non-member pin %q lies between its members (FR-063a); lay out the symbol so each bus group is contiguous on its side", path, g.Name, p.Name)
		}
	}
	return nil
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
