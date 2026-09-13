package server

// yamlparse.go converts one component-definition YAML file (design §7.6) into a
// ComponentType (§7.1). It decodes with gopkg.in/yaml.v3 (YAML 1.2 core schema,
// so single-letter scalars like N/Y stay strings), ignores unknown keys so the
// format stays additive (FR-066), captures behavioral content verbatim, and
// validates the structural fields (§6.3).

import (
	"errors"
	"fmt"
	"os"
	"strings"

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

// ncPinName is the pin name reserved library-wide for "no connect" (FR-062f). It
// is the one name exempt from within-file uniqueness, precisely because nothing
// may ever reference it: it can carry no connection, join no group, be no clock,
// and appear in no equation (the behavior compiler enforces that last one, §6.13).
const ncPinName = "NC"

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
	Internal   []string           `yaml:"internal"`
	Gal        string             `yaml:"gal"`
	PartNumber string             `yaml:"partnumber"`

	// Documentation (FR-104), all optional.
	Description string         `yaml:"description"`
	Notes       string         `yaml:"notes"` // free-form prose (FR-125a); distinct from Description
	Datasheet   *yamlDatasheet `yaml:"datasheet"`

	// Generated memory device (FR-114f), optional.
	Mem *yamlMem `yaml:"mem"`

	// Exporter-only physical-package metadata (FR-062e), optional.
	Physical *yamlPhysical `yaml:"physical"`
}

// yamlPhysical is the on-disk shape of the exporter-only physical block
// (FR-062e). Numbers are pointers so an omitted required field is
// distinguishable from a legitimate value.
type yamlPhysical struct {
	Package  string         `yaml:"package"`
	PinCount int            `yaml:"pincount"`
	Power    []yamlPowerPin `yaml:"power"`
	NC       []int          `yaml:"nc"`
}

type yamlPowerPin struct {
	Name   string `yaml:"name"`
	Number *int   `yaml:"number"`
}

// yamlMem is the on-disk shape of a generated memory device's parameters
// (FR-114f); keys match the client's emitted `mem:` block (memDeviceYaml).
type yamlMem struct {
	Kind        string `yaml:"kind"`
	AddressBits int    `yaml:"addressBits"`
	DataWidth   int    `yaml:"dataWidth"`
	Locations   int    `yaml:"locations"`
	RomFile     string `yaml:"romFile"`
	RamFile     string `yaml:"ramFile"`
	RamLoad     bool   `yaml:"ramLoad"`
}

type yamlPin struct {
	Name   string `yaml:"name"`
	Side   string `yaml:"side"`
	Pos    *int   `yaml:"pos"`
	Unit   string `yaml:"unit"`
	Dir    string `yaml:"dir"`
	Number *int   `yaml:"number"`
	Desc   string `yaml:"desc"`
	OLMC   string `yaml:"olmc"` // GAL parts only (FR-066i)
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

// knownTopKeys are the top-level YAML keys yamlComponent maps. A GAL part's
// other top-level keys are carried in ComponentType.Extra (FR-066j) so the Edit
// GAL part dialog can write them back; every other type ignores them (FR-066).
var knownTopKeys = map[string]bool{
	"id": true, "type": true, "rendertype": true, "numunits": true, "renderas": true,
	"outline": true, "pins": true, "groups": true, "delays": true, "behavior": true,
	"clock": true, "internal": true, "gal": true, "partnumber": true,
	"description": true, "notes": true, "datasheet": true, "mem": true, "physical": true,
}

// ParseComponentBytes parses already-read component YAML with the same validation
// as ParseComponent (§6.3); it backs the in-app create path (FR-007a), whose YAML
// arrives in a request body rather than on disk. The path argument only labels
// error messages (a file path, or a stand-in like "(submitted)").
//
// A GAL part (one declaring `gal:`) is parsed leniently (FR-066j): the only error
// it returns is YAML that does not decode. Every other violation is appended to
// the returned type's LoadErrors and parsing continues with a defined fallback,
// so an inconsistent definition still loads, draws red, and opens in the dialog.
// Every other type is validated strictly, exactly as before.
func ParseComponentBytes(data []byte, path string) (ComponentType, error) {
	var doc yamlComponent
	var loadErrors []string
	if err := yaml.Unmarshal(data, &doc); err != nil {
		// A type mismatch (e.g. `pos: abc`) is not a syntax error: yaml.v3 still
		// decodes everything else, so a GAL part records it and carries on.
		var te *yaml.TypeError
		if !errors.As(err, &te) || doc.Gal == "" {
			return ComponentType{}, fmt.Errorf("%s: %w", path, err)
		}
		loadErrors = append(loadErrors, te.Errors...)
	}
	lenient := doc.Gal != ""

	// fail reports one violation. Strict: it records the error and returns true —
	// the caller returns strictErr. Lenient: it collects the message and returns
	// false — the caller applies its fallback and continues.
	var strictErr error
	fail := func(format string, a ...any) bool {
		msg := fmt.Sprintf(format, a...)
		if lenient {
			loadErrors = append(loadErrors, msg)
			return false
		}
		strictErr = fmt.Errorf("%s: %s", path, msg)
		return true
	}
	// failErr is fail for a helper's already-formatted "path: msg" error.
	failErr := func(err error) bool {
		return fail("%s", strings.TrimPrefix(err.Error(), path+": "))
	}

	if doc.Type == "" {
		if fail("missing required field 'type' (quote all-digit names, e.g. \"74138\")") {
			return ComponentType{}, strictErr
		}
	}

	renderType := doc.RenderType
	if renderType == "" {
		renderType = "unit"
	}
	if renderType != "unit" && renderType != "subunit" {
		if fail("invalid rendertype %q (want unit|subunit)", renderType) {
			return ComponentType{}, strictErr
		}
		renderType = "unit"
	}
	subunit := renderType == "subunit"

	pinNames := make(map[string]bool, len(doc.Pins))
	pins := make([]Pin, 0, len(doc.Pins))
	for i, p := range doc.Pins {
		if p.Name == "" {
			if fail("pin %d: missing 'name'", i) {
				return ComponentType{}, strictErr
			}
			continue // nothing can key a nameless pin
		}
		unplaced := false
		if !validSides[p.Side] {
			if fail("pin %q: invalid side %q (want left|right|top|bottom)", p.Name, p.Side) {
				return ComponentType{}, strictErr
			}
			unplaced = true
		}
		dir := p.Dir
		if !validDirs[p.Dir] {
			if fail("pin %q: invalid dir %q (want in|out|bidir|tristate)", p.Name, p.Dir) {
				return ComponentType{}, strictErr
			}
			dir = "in"
		}
		if pinNames[p.Name] && p.Name != ncPinName {
			// A duplicate pin name would make saved endpoint references like
			// "U3.A0" ambiguous (§6.3). NC is the sole exception (FR-062f): it may
			// repeat because nothing may ever reference it.
			if fail("duplicate pin name %q", p.Name) {
				return ComponentType{}, strictErr
			}
		}
		var pos int
		if subunit {
			// pos is dictated by the symbol and ignored; the unit assigns the pin
			// to a functional unit instead (FR-014a, §6.3).
			if p.Unit == "" {
				if fail("pin %q: missing 'unit' (required for rendertype: subunit)", p.Name) {
					return ComponentType{}, strictErr
				}
			}
		} else {
			switch {
			case p.Pos == nil:
				if fail("pin %q: missing 'pos'", p.Name) {
					return ComponentType{}, strictErr
				}
				unplaced = true
			case *p.Pos < 0:
				if fail("pin %q: pos %d must be >= 0", p.Name, *p.Pos) {
					return ComponentType{}, strictErr
				}
				unplaced = true
			default:
				pos = *p.Pos
			}
		}
		// olmc (FR-066i) declares a GAL output's registered-ness independently of
		// the behavior block; it means nothing on any other type and is ignored.
		olmc := ""
		if lenient && p.OLMC != "" {
			switch {
			case p.OLMC != "reg" && p.OLMC != "comb":
				fail("pin %q: invalid olmc %q (want reg|comb)", p.Name, p.OLMC)
			case dir == "in":
				fail("pin %q: olmc: %s on an input pin (olmc declares an output's type)", p.Name, p.OLMC)
			default:
				olmc = p.OLMC
			}
		}
		pinNames[p.Name] = true
		pins = append(pins, Pin{
			Name:      p.Name,
			Side:      p.Side,
			Position:  pos,
			Unit:      p.Unit,
			Direction: dir,
			Number:    p.Number,
			Desc:      p.Desc,
			OLMC:      olmc,
			Unplaced:  unplaced,
		})
	}

	// clock: must name an existing input pin (FR-062d). Whether the behavior
	// actually requires a clock (uses .R) is checked client-side at Run time
	// (§6.13) — the behavior block is opaque to the server (FR-066). A GAL part
	// carries a bad clock: as written (FR-066j).
	if doc.Clock == ncPinName {
		if fail("clock pin may not be %q (no connect, FR-062f)", ncPinName) {
			return ComponentType{}, strictErr
		}
	} else if doc.Clock != "" {
		found := false
		for _, p := range pins {
			if p.Name == doc.Clock {
				if p.Direction != "in" {
					if fail("clock pin %q must have dir in, got %q", doc.Clock, p.Direction) {
						return ComponentType{}, strictErr
					}
				}
				found = true
				break
			}
		}
		if !found {
			if fail("clock names unknown pin %q", doc.Clock) {
				return ComponentType{}, strictErr
			}
		}
	}

	// gal: (FR-066a) — validate only the device name; the strict-vs-extended
	// dialect it selects is enforced client-side at Run (§6.13).
	if doc.Gal != "" && !validGalDevices[doc.Gal] {
		fail("gal names unknown device %q (want GAL16V8|GAL20V8|GAL22V10|GAL20RA10)", doc.Gal)
	}

	// partnumber: a GAL part (gal set) names a specific programmed part, with type
	// giving only the device family and partnumber the display name (FR-066b). The
	// two go together: gal requires a partnumber, and a partnumber is meaningless
	// without gal.
	if doc.Gal != "" && doc.PartNumber == "" {
		fail("a gal part requires a 'partnumber' (the part's display name; type names only the device family)")
	}
	if doc.Gal == "" && doc.PartNumber != "" {
		if fail("'partnumber' is only valid on a gal part (set 'gal:')") {
			return ComponentType{}, strictErr
		}
	}

	// internal: buried registered-node names (FR-079c) — the same opaque-carry
	// treatment as clock:/gal:. The server checks only that each name is a legal,
	// unique signal token distinct from every pin (buried nodes and pins share one
	// signal namespace, so a pin's signal is its name with any leading '/' dropped);
	// whether each declared node actually has a .R equation is checked client-side
	// at Run (§6.13), the behavior block being opaque to the server (FR-066).
	if len(doc.Internal) > 0 {
		pinSignals := make(map[string]bool, len(pins))
		for _, p := range pins {
			pinSignals[strings.TrimPrefix(p.Name, "/")] = true
		}
		seen := make(map[string]bool, len(doc.Internal))
		for _, name := range doc.Internal {
			switch {
			case !isSignalToken(name):
				if fail("internal node %q is not a legal signal name (letters and digits only)", name) {
					return ComponentType{}, strictErr
				}
			case seen[name]:
				if fail("duplicate internal node name %q", name) {
					return ComponentType{}, strictErr
				}
			case pinSignals[name]:
				if fail("internal node %q collides with a pin signal (buried nodes and pins share one signal namespace)", name) {
					return ComponentType{}, strictErr
				}
			}
			seen[name] = true
		}
	}

	// mem: (FR-114f) — a generated memory device. The client owns the full pinout
	// (parsed above like any component); this block carries the parameters the
	// client's built-in behavior binds from (FR-114d). Validate the few fields the
	// server can check; the device class drives nothing server-side.
	var mem *MemSpec
	if doc.Mem != nil {
		m := doc.Mem
		if m.Kind != "ram" && m.Kind != "rom" {
			if fail("mem.kind %q invalid (want ram|rom)", m.Kind) {
				return ComponentType{}, strictErr
			}
		}
		if m.AddressBits < 1 {
			if fail("mem.addressBits %d must be >= 1", m.AddressBits) {
				return ComponentType{}, strictErr
			}
		}
		if m.DataWidth != 4 && m.DataWidth != 8 && m.DataWidth != 16 && m.DataWidth != 32 {
			if fail("mem.dataWidth %d invalid (want 4|8|16|32)", m.DataWidth) {
				return ComponentType{}, strictErr
			}
		}
		mem = &MemSpec{
			Kind:        m.Kind,
			AddressBits: m.AddressBits,
			DataWidth:   m.DataWidth,
			Locations:   m.Locations,
			RomFile:     m.RomFile,
			RamFile:     m.RamFile,
			RamLoad:     m.RamLoad,
		}
	}

	// physical: (FR-062e) — exporter-only package metadata, carried verbatim
	// like mem:. Presence triggers the physical-completeness validation (§6.3);
	// nothing geometric or behavioral reads the block. A GAL part that fails it
	// still carries the block, so the dialog can write it back (FR-066j).
	physical, err := validatePhysical(path, doc.Physical, pins)
	if err != nil {
		if failErr(err) {
			return ComponentType{}, strictErr
		}
		physical = physicalSpecOf(doc.Physical)
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
	// A GAL part's bad group is left out of pinGroups (FR-066j): a group naming
	// an unknown pin would break every consumer that resolves its members.
	var groups []PinGroup
	groupNames := make(map[string]bool, len(doc.Groups))
groupLoop:
	for _, g := range doc.Groups {
		if groupNames[g.Name] {
			if fail("duplicate group name %q", g.Name) {
				return ComponentType{}, strictErr
			}
			continue
		}
		groupNames[g.Name] = true
		if len(g.Pins) == 0 {
			if fail("group %q has no members", g.Name) {
				return ComponentType{}, strictErr
			}
			continue
		}
		for _, member := range g.Pins {
			if member == ncPinName {
				// A no-connect pin carries no signal, so it cannot be a bus lane
				// (FR-062f) — and being non-unique it would not name one pin anyway.
				if fail("group %q names %q, which is a no-connect pin (FR-062f)", g.Name, member) {
					return ComponentType{}, strictErr
				}
				continue groupLoop
			}
			if !pinNames[member] {
				if fail("group %q names unknown pin %q", g.Name, member) {
					return ComponentType{}, strictErr
				}
				continue groupLoop
			}
		}
		if err := validateGroupGeometry(path, g, pins, pinByName, subunit); err != nil {
			if failErr(err) {
				return ComponentType{}, strictErr
			}
			continue
		}
		groups = append(groups, PinGroup{Name: g.Name, Pins: g.Pins})
	}

	// Documentation (FR-104): presentation-only, copied through verbatim.
	var datasheet *Datasheet
	if d := doc.Datasheet; d != nil {
		datasheet = &Datasheet{Vendor: d.Vendor, Title: d.Title, Rev: d.Rev, URL: d.URL}
	}

	var extra map[string]any
	if lenient {
		extra = extraTopKeys(data)
	}

	ct := ComponentType{
		ID:          id,
		Name:        doc.Type,
		Pins:        pins,
		PinGroups:   groups,
		Delays:      doc.Delays,
		Behavior:    doc.Behavior,
		Clock:       doc.Clock,
		Internal:    doc.Internal,
		Gal:         doc.Gal,
		PartNumber:  doc.PartNumber,
		Description: doc.Description,
		Notes:       doc.Notes,
		Datasheet:   datasheet,
		Mem:         mem,
		Physical:    physical,
		Extra:       extra,
	}

	if subunit {
		if err := validateSubunit(path, doc.RenderAs, doc.NumUnits, pins); err != nil {
			if failErr(err) {
				return ComponentType{}, strictErr
			}
		}
		// Outline/width/height are unused for subunits; the client symbol module
		// (§6.8a) owns each unit's footprint and pin positions.
		ct.RenderType = "subunit"
		ct.NumUnits = doc.NumUnits
		ct.RenderAs = doc.RenderAs
		ct.LoadErrors = loadErrors
		return ct, nil
	}

	width, height, err := resolveOutline(doc.Outline, pins)
	if err != nil {
		if fail("%v", err) {
			return ComponentType{}, strictErr
		}
		width, height, _ = resolveOutline(nil, pins)
	}

	// Every pin must lie within the resolved outline (§6.3); only an explicit
	// outline: smaller than the author-placed pins can violate this — a derived
	// outline is sized to fit.
	for _, p := range pins {
		if p.Unplaced {
			continue
		}
		switch p.Side {
		case "left", "right":
			if p.Position > height {
				if fail("pin %q: pos %d exceeds outline height %d", p.Name, p.Position, height) {
					return ComponentType{}, strictErr
				}
			}
		case "top", "bottom":
			if p.Position > width {
				if fail("pin %q: pos %d exceeds outline width %d", p.Name, p.Position, width) {
					return ComponentType{}, strictErr
				}
			}
		}
	}

	ct.RenderType = "unit"
	ct.Width = width
	ct.Height = height
	ct.LoadErrors = loadErrors
	return ct, nil
}

// physicalSpecOf maps a physical: block onto a PhysicalSpec without validating
// it — the fallback for a GAL part whose block fails validatePhysical, which is
// carried anyway so an in-app save does not drop it (FR-066j).
func physicalSpecOf(phys *yamlPhysical) *PhysicalSpec {
	if phys == nil {
		return nil
	}
	power := make([]PowerPin, 0, len(phys.Power))
	for _, pw := range phys.Power {
		n := 0
		if pw.Number != nil {
			n = *pw.Number
		}
		power = append(power, PowerPin{Name: pw.Name, Number: n})
	}
	return &PhysicalSpec{Package: phys.Package, PinCount: phys.PinCount, Power: power, NC: phys.NC}
}

// extraTopKeys decodes the document's top-level keys that yamlComponent does not
// map (FR-066j), or nil when there are none. Values are made JSON-safe: yaml.v3
// decodes a mapping with a non-string key as map[any]any, which encoding/json
// cannot marshal, and one such key must not break the whole /components response.
func extraTopKeys(data []byte) map[string]any {
	var raw map[string]any
	if err := yaml.Unmarshal(data, &raw); err != nil {
		return nil
	}
	var extra map[string]any
	for k, v := range raw {
		if knownTopKeys[k] {
			continue
		}
		if extra == nil {
			extra = make(map[string]any)
		}
		extra[k] = jsonSafe(v)
	}
	return extra
}

// jsonSafe rewrites map[any]any values (at any depth) as map[string]any.
func jsonSafe(v any) any {
	switch t := v.(type) {
	case map[string]any:
		for k, e := range t {
			t[k] = jsonSafe(e)
		}
		return t
	case map[any]any:
		m := make(map[string]any, len(t))
		for k, e := range t {
			m[fmt.Sprint(k)] = jsonSafe(e)
		}
		return m
	case []any:
		for i, e := range t {
			t[i] = jsonSafe(e)
		}
		return t
	}
	return v
}

// validatePhysical checks the optional exporter-only physical: block (FR-062e)
// and maps it onto a PhysicalSpec. A nil block returns nil — numbers stay
// optional metadata (FR-062b). A present block must be physically complete:
// every signal pin numbered; every power entry named and numbered; signal,
// power, and nc numbers mutually distinct and together exactly the set
// 1..pincount; no power name equal to a pin name (exporters emit both into one
// namespace). Distinctness + range + count == pincount implies the exact tiling.
func validatePhysical(path string, phys *yamlPhysical, pins []Pin) (*PhysicalSpec, error) {
	if phys == nil {
		return nil, nil
	}
	if phys.PinCount < 1 {
		return nil, fmt.Errorf("%s: physical: missing or invalid 'pincount' (want a positive pin count)", path)
	}
	used := make(map[int]string, phys.PinCount) // number -> what claimed it, for error text
	claim := func(n int, what string) error {
		if n < 1 || n > phys.PinCount {
			return fmt.Errorf("%s: physical: %s has pin number %d outside 1..%d", path, what, n, phys.PinCount)
		}
		if prev, dup := used[n]; dup {
			return fmt.Errorf("%s: physical: pin number %d claimed by both %s and %s", path, n, prev, what)
		}
		used[n] = what
		return nil
	}

	pinNames := make(map[string]bool, len(pins))
	for _, p := range pins {
		pinNames[p.Name] = true
		if p.Number == nil {
			return nil, fmt.Errorf("%s: physical: signal pin %q has no 'number' (a physical: block requires every pin numbered)", path, p.Name)
		}
		if err := claim(*p.Number, fmt.Sprintf("pin %q", p.Name)); err != nil {
			return nil, err
		}
	}

	power := make([]PowerPin, 0, len(phys.Power))
	for i, pw := range phys.Power {
		if pw.Name == "" {
			return nil, fmt.Errorf("%s: physical: power entry %d: missing 'name'", path, i)
		}
		if pinNames[pw.Name] {
			return nil, fmt.Errorf("%s: physical: power name %q collides with a signal pin name", path, pw.Name)
		}
		if pw.Number == nil {
			return nil, fmt.Errorf("%s: physical: power %q: missing 'number'", path, pw.Name)
		}
		if err := claim(*pw.Number, fmt.Sprintf("power %q", pw.Name)); err != nil {
			return nil, err
		}
		power = append(power, PowerPin{Name: pw.Name, Number: *pw.Number})
	}

	for _, n := range phys.NC {
		if err := claim(n, "nc"); err != nil {
			return nil, err
		}
	}

	if len(used) != phys.PinCount {
		var missing []string
		for n := 1; n <= phys.PinCount; n++ {
			if _, ok := used[n]; !ok {
				missing = append(missing, fmt.Sprintf("%d", n))
			}
		}
		return nil, fmt.Errorf("%s: physical: pincount is %d but pins %s are unaccounted for (not signal, power, or nc)", path, phys.PinCount, strings.Join(missing, ","))
	}

	return &PhysicalSpec{
		Package:  phys.Package,
		PinCount: phys.PinCount,
		Power:    power,
		NC:       phys.NC,
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

// isSignalToken reports whether s is a legal GALasm signal name (§6.13): a
// non-empty run of ASCII letters and digits. The client's compiler is the
// authoritative lexer (length and reserved-word checks, §6.13); the server
// applies this minimal check to internal-node names (FR-079c), consistent with
// keeping the behavior block otherwise opaque (FR-066).
func isSignalToken(s string) bool {
	if s == "" {
		return false
	}
	for _, r := range s {
		if !((r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9')) {
			return false
		}
	}
	return true
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
