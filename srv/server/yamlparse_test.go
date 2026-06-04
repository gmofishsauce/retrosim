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
		Name:   "74138",
		Width:  6,
		Height: 12,
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
		{"outline wrong length", "type: T\noutline: [6]\npins: []\n", "outline must be"},
		{"outline non-positive", "type: T\noutline: [0, 5]\npins: []\n", "must be > 0"},
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
