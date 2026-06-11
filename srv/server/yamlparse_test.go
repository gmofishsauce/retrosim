package server

import (
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

// writeYAML writes content to a temp .yaml file and returns its path.
func writeYAML(t *testing.T, content string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "c.yaml")
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatalf("write temp yaml: %v", err)
	}
	return path
}

// A complete, valid file maps 1:1 onto ComponentType (§7.6), including an explicit
// outline, a pin number, a group, delays, and a verbatim behavior block.
func TestParseComponentValid(t *testing.T) {
	path := writeYAML(t, `
type: "74138"
outline: [6, 12]
pins:
  - { name: A0,  side: left,  pos: 2, dir: in }
  - { name: A1,  side: left,  pos: 3, dir: in, number: 2 }
  - { name: /Y0, side: right, pos: 2, dir: out }
groups:
  - { name: A, pins: [A0, A1] }
delays:
  tpd: 7
behavior: |
  /Y0 = /(/A1 * /A0)
  ; a comment
`)

	got, err := ParseComponent(path)
	if err != nil {
		t.Fatalf("ParseComponent: %v", err)
	}

	two := 2
	want := ComponentType{
		Name:       "74138",
		RenderType: "unit",
		Width:      6,
		Height:     12,
		Pins: []Pin{
			{Name: "A0", Side: "left", Position: 2, Direction: "in"},
			{Name: "A1", Side: "left", Position: 3, Direction: "in", Number: &two},
			{Name: "/Y0", Side: "right", Position: 2, Direction: "out"},
		},
		PinGroups: []PinGroup{{Name: "A", Pins: []string{"A0", "A1"}}},
		Delays:    map[string]float64{"tpd": 7},
		Behavior:  "/Y0 = /(/A1 * /A0)\n; a comment\n",
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("ParseComponent = %+v\nwant %+v", got, want)
	}
}

// A subunit package maps onto renderType/numUnits/renderAs + per-pin unit, with
// pos ignored and width/height left zero (§7.6, FR-062c).
func TestParseComponentSubunit(t *testing.T) {
	path := writeYAML(t, `
type: "7400"
rendertype: subunit
numunits: 2
renderas: nand
pins:
  - { name: 1A, side: left,  unit: A, dir: in }
  - { name: 1B, side: left,  unit: A, dir: in }
  - { name: 1Y, side: right, unit: A, dir: out }
  - { name: 2A, side: left,  unit: B, dir: in }
  - { name: 2B, side: left,  unit: B, dir: in }
  - { name: 2Y, side: right, unit: B, dir: out }
`)

	got, err := ParseComponent(path)
	if err != nil {
		t.Fatalf("ParseComponent: %v", err)
	}

	want := ComponentType{
		Name:       "7400",
		RenderType: "subunit",
		NumUnits:   2,
		RenderAs:   "nand",
		Pins: []Pin{
			{Name: "1A", Side: "left", Unit: "A", Direction: "in"},
			{Name: "1B", Side: "left", Unit: "A", Direction: "in"},
			{Name: "1Y", Side: "right", Unit: "A", Direction: "out"},
			{Name: "2A", Side: "left", Unit: "B", Direction: "in"},
			{Name: "2B", Side: "left", Unit: "B", Direction: "in"},
			{Name: "2Y", Side: "right", Unit: "B", Direction: "out"},
		},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("ParseComponent = %+v\nwant %+v", got, want)
	}
}

// With no outline:, dimensions derive from pins: top/bottom set width, left/right
// set height, plus margin, floored at minOutlineDim (§6.3).
func TestParseComponentDerivedOutline(t *testing.T) {
	path := writeYAML(t, `
type: T
pins:
  - { name: A0, side: left,   pos: 9, dir: in }
  - { name: C0, side: bottom, pos: 3, dir: in }
`)
	got, err := ParseComponent(path)
	if err != nil {
		t.Fatalf("ParseComponent: %v", err)
	}
	if got.Height != 9+outlineMargin {
		t.Errorf("Height = %d, want %d", got.Height, 9+outlineMargin)
	}
	if got.Width != 3+outlineMargin {
		t.Errorf("Width = %d, want %d", got.Width, 3+outlineMargin)
	}
}

// A side with no pins still gets at least minOutlineDim.
func TestParseComponentDerivedOutlineFloor(t *testing.T) {
	path := writeYAML(t, `
type: T
pins:
  - { name: A0, side: left, pos: 2, dir: in }
`)
	got, err := ParseComponent(path)
	if err != nil {
		t.Fatalf("ParseComponent: %v", err)
	}
	if got.Width != minOutlineDim {
		t.Errorf("Width = %d, want %d (floor)", got.Width, minOutlineDim)
	}
}

// Unknown top-level keys are ignored, not errors, so the format stays additive
// (FR-066).
func TestParseComponentIgnoresUnknownKeys(t *testing.T) {
	path := writeYAML(t, `
type: T
future_section: { anything: goes }
pins:
  - { name: A0, side: left, pos: 2, dir: in }
`)
	if _, err := ParseComponent(path); err != nil {
		t.Fatalf("unknown key should be ignored, got %v", err)
	}
}

func TestParseComponentErrors(t *testing.T) {
	cases := []struct {
		name    string
		yaml    string
		wantSub string
	}{
		{"missing type", "pins: []\n", "missing required field 'type'"},
		{"pin missing name", "type: T\npins:\n  - { side: left, pos: 1, dir: in }\n", "missing 'name'"},
		{"bad side", "type: T\npins:\n  - { name: A0, side: sideways, pos: 1, dir: in }\n", "invalid side"},
		{"missing pos", "type: T\npins:\n  - { name: A0, side: left, dir: in }\n", "missing 'pos'"},
		{"negative pos", "type: T\npins:\n  - { name: A0, side: left, pos: -1, dir: in }\n", "must be >= 0"},
		{"bad dir", "type: T\npins:\n  - { name: A0, side: left, pos: 1, dir: sideways }\n", "invalid dir"},
		{"group unknown pin", "type: T\npins:\n  - { name: A0, side: left, pos: 1, dir: in }\ngroups:\n  - { name: G, pins: [A9] }\n", "unknown pin"},
		{"duplicate pin name", "type: T\npins:\n  - { name: A0, side: left, pos: 1, dir: in }\n  - { name: A0, side: left, pos: 2, dir: in }\n", "duplicate pin name"},
		{"duplicate group name", "type: T\npins:\n  - { name: A0, side: left, pos: 1, dir: in }\ngroups:\n  - { name: G, pins: [A0] }\n  - { name: G, pins: [A0] }\n", "duplicate group name"},
		{"pin outside explicit outline", "type: T\noutline: [4, 4]\npins:\n  - { name: A0, side: left, pos: 9, dir: in }\n", "exceeds outline height"},
		{"outline wrong length", "type: T\noutline: [6]\npins: []\n", "outline must be"},
		{"outline non-positive", "type: T\noutline: [0, 5]\npins: []\n", "must be > 0"},
		{"bad rendertype", "type: T\nrendertype: weird\npins: []\n", "invalid rendertype"},
		{"subunit bad renderas", "type: T\nrendertype: subunit\nnumunits: 1\nrenderas: zorp\npins:\n  - { name: A, side: left, unit: A, dir: in }\n  - { name: Y, side: right, unit: A, dir: out }\n", "invalid renderas"},
		{"subunit missing unit", "type: T\nrendertype: subunit\nnumunits: 1\nrenderas: nand\npins:\n  - { name: A, side: left, dir: in }\n  - { name: Y, side: right, unit: A, dir: out }\n", "missing 'unit'"},
		{"subunit numunits mismatch", "type: T\nrendertype: subunit\nnumunits: 2\nrenderas: nand\npins:\n  - { name: A, side: left, unit: A, dir: in }\n  - { name: Y, side: right, unit: A, dir: out }\n", "distinct units"},
		{"subunit two outputs", "type: T\nrendertype: subunit\nnumunits: 1\nrenderas: nand\npins:\n  - { name: A, side: left, unit: A, dir: in }\n  - { name: Y, side: right, unit: A, dir: out }\n  - { name: Z, side: right, unit: A, dir: out }\n", "exactly 1 output"},
		{"mux wrong arity", "type: T\nrendertype: subunit\nnumunits: 1\nrenderas: mux2\npins:\n  - { name: I0, side: left, unit: A, dir: in }\n  - { name: S, side: top, unit: A, dir: in }\n  - { name: Y, side: right, unit: A, dir: out }\n", "data inputs"},
		{"clock unknown pin", "type: T\nclock: CP\npins:\n  - { name: A0, side: left, pos: 1, dir: in }\n", "clock names unknown pin"},
		{"clock non-input pin", "type: T\nclock: Q0\npins:\n  - { name: Q0, side: right, pos: 1, dir: out }\n", "must have dir in"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := ParseComponent(writeYAML(t, tc.yaml))
			if err == nil {
				t.Fatalf("expected error containing %q, got nil", tc.wantSub)
			}
			if !strings.Contains(err.Error(), tc.wantSub) {
				t.Fatalf("error = %q, want substring %q", err.Error(), tc.wantSub)
			}
		})
	}
}

// A valid clock: key names an existing input pin and lands in Clock (FR-062d).
func TestParseComponentClock(t *testing.T) {
	got, err := ParseComponent(writeYAML(t, `
type: "74574"
clock: CP
pins:
  - { name: D0, side: left,  pos: 2, dir: in }
  - { name: Q0, side: right, pos: 2, dir: tristate }
  - { name: CP, side: top,   pos: 2, dir: in }
`))
	if err != nil {
		t.Fatalf("ParseComponent: %v", err)
	}
	if got.Clock != "CP" {
		t.Fatalf("Clock = %q, want %q", got.Clock, "CP")
	}
}

// yaml.v3 coerces a bare-digit type: scalar into the string name (the §7.6
// "quote it" guidance is a safety recommendation, not enforced by the parser).
func TestParseComponentBareIntTypeCoerced(t *testing.T) {
	got, err := ParseComponent(writeYAML(t, "type: 74138\npins: []\n"))
	if err != nil {
		t.Fatalf("ParseComponent: %v", err)
	}
	if got.Name != "74138" {
		t.Errorf("Name = %q, want %q", got.Name, "74138")
	}
}

// A missing file returns an error, not a panic.
func TestParseComponentMissingFile(t *testing.T) {
	if _, err := ParseComponent(filepath.Join(t.TempDir(), "nope.yaml")); err == nil {
		t.Fatal("expected error for missing file")
	}
}
