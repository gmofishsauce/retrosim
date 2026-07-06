// Package server holds the retrosim HTTP server: the component library, the
// MD parser, design storage, and the REST API. This file defines the component
// library data model (design.md §7.1), shared by the in-memory library, the
// /api/v1/components response, and the full-copy embedded in saved designs
// (FR-057).
package server

// ComponentType is one TTL component definition, parsed from a YAML file
// (FR-062). For "unit" components width/height are always concrete grid-unit
// dimensions once parsed (stated or derived from pins — §6.3). For "subunit"
// components (FR-062c) width/height are unused — the client symbol module owns
// geometry (§6.8a).
type ComponentType struct {
	ID         string             `json:"id"`                   // immutable, library-unique key (FR-066e), e.g. "type-74138"; divorced from the display name
	Name       string             `json:"name"`                 // free-form display name, e.g. "74138" (FR-005); the device family for a GAL part
	RenderType string             `json:"renderType"`           // "unit" (default) | "subunit" (FR-062c)
	NumUnits   int                `json:"numUnits,omitempty"`   // subunit: number of functional units (FR-062c)
	RenderAs   string             `json:"renderAs,omitempty"`   // subunit: schematic symbol (FR-013b)
	Width      int                `json:"width"`                // unit only: outline width in grid units (>0)
	Height     int                `json:"height"`               // unit only: outline height in grid units (>0)
	Pins       []Pin              `json:"pins"`                 // FR-062, FR-062a
	PinGroups  []PinGroup         `json:"pinGroups,omitempty"`  // optional (FR-063)
	Delays     map[string]float64 `json:"delays,omitempty"`     // optional propagation delays, ns (FR-064)
	Behavior   string             `json:"behavior,omitempty"`   // GALasm text, captured verbatim (FR-066); evaluated client-side (FR-079)
	Clock      string             `json:"clock,omitempty"`      // optional clock input pin for .R behavior outputs (FR-062d)
	Internal   []string           `json:"internal,omitempty"`   // optional buried registered-node names (FR-079c); each defined by one .R equation, checked client-side at Run (§6.13)
	Gal        string             `json:"gal,omitempty"`        // optional GAL device selecting strict dialect (FR-066a); "" = extended (FR-079a)
	PartNumber string             `json:"partnumber,omitempty"` // GAL parts only: free-form display name (FR-066b/FR-005b); not a key; "" for 74-series

	// Documentation (FR-104): optional, presentation-only. Copied through to the
	// properties panel (FR-105); never affects geometry, pins, or simulation.
	Description string     `json:"description,omitempty"` // one-line function summary
	Datasheet   *Datasheet `json:"datasheet,omitempty"`   // datasheet provenance + link

	// Mem marks a generated memory device (FR-114c/FR-114f). Carried through
	// verbatim from the YAML so the client's built-in memory behavior (FR-114d)
	// binds from this serializable data on reload. Absent on all other types.
	Mem *MemSpec `json:"mem,omitempty"`

	// Physical is exporter-only package metadata (FR-062e): carried through
	// verbatim like Mem and copied into saves (FR-057) so netlist exporters
	// (KiCad, NDL, BOM) can work from the design JSON alone. Read by no editor
	// or simulator code; power/ground stay unrepresented there (FR-062).
	Physical *PhysicalSpec `json:"physical,omitempty"`
}

// PhysicalSpec describes a component's physical package for exporters
// (FR-062e). When present, the parser has verified physical completeness: all
// signal pins carry a number, and signal + power + NC numbers tile exactly
// 1..PinCount with no duplicates (§6.3).
type PhysicalSpec struct {
	Package  string     `json:"package,omitempty"` // free-form package name, e.g. "DIP-14"; uninterpreted — exporters own the mapping
	PinCount int        `json:"pincount"`          // total physical pin count
	Power    []PowerPin `json:"power"`             // power/ground pins (absent from Pins per FR-062)
	NC       []int      `json:"nc,omitempty"`      // physically no-connect pin numbers
}

// PowerPin names one power/ground pin (FR-062e). Name is the rail net label an
// exporter attaches the pin to (e.g. "VCC", "GND"); several entries may share a
// name (multi-ground packages) but a name never collides with a signal pin's.
type PowerPin struct {
	Name   string `json:"name"`
	Number int    `json:"number"`
}

// MemSpec is a generated memory device's parameters (FR-114c/FR-114f). Field
// names match the client's `typeData.mem` shape (engine/memory.js, sim.js).
type MemSpec struct {
	Kind        string `json:"kind"`              // "ram" | "rom"
	AddressBits int    `json:"addressBits"`       // address-input count n (locations = 2^n)
	DataWidth   int    `json:"dataWidth"`         // data width in bits: 4 | 8 | 16 | 32
	Locations   int    `json:"locations"`         // 2^AddressBits, recorded for fidelity
	RomFile     string `json:"romFile,omitempty"` // ROM only: absolute content-file path (FR-114e)
}

// Key is a component's library identity (§6.2): its immutable internal id
// (FR-066e), divorced from the free-form display name (Name/PartNumber). The
// parser populates ID for every type (explicit, or derived from the display
// name when the YAML omits it — deriveID), so distinct GAL parts of one family
// coexist by distinct ids.
func (t ComponentType) Key() string {
	return t.ID
}

// Datasheet is the optional documentation provenance for a component (FR-104).
type Datasheet struct {
	Vendor string `json:"vendor,omitempty"` // manufacturer, e.g. "Nexperia"
	Title  string `json:"title,omitempty"`  // document title
	Rev    string `json:"rev,omitempty"`    // revision/date
	URL    string `json:"url,omitempty"`    // link to the datasheet PDF
}

// Pin is one connection point on a component's outline (FR-062, FR-062a).
type Pin struct {
	Name      string `json:"name"`             // e.g. "A0", "/Y3"
	Side      string `json:"side"`             // "left" | "right" | "top" | "bottom" (FR-014)
	Position  int    `json:"position"`         // unit only: grid units along the side from its origin
	Unit      string `json:"unit,omitempty"`   // subunit only: unit letter this pin belongs to (FR-014a)
	Direction string `json:"direction"`        // "in" | "out" | "bidir" | "tristate" (FR-062a)
	Number    *int   `json:"number,omitempty"` // optional physical pin number (FR-062b)
	Desc      string `json:"desc,omitempty"`   // optional pin role for documentation (FR-104)
}

// PinGroup is a named, ordered set of pins forming a bus interface for
// snap-connection (FR-063). Group width = number of member pins (each is 1 bit).
type PinGroup struct {
	Name string   `json:"name"` // e.g. "A", "DATA"
	Pins []string `json:"pins"` // ordered member pin names (bit order)
}
