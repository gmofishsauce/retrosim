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
	Name       string             `json:"name"`                // unique type name, e.g. "74138"
	RenderType string             `json:"renderType"`          // "unit" (default) | "subunit" (FR-062c)
	NumUnits   int                `json:"numUnits,omitempty"`  // subunit: number of functional units (FR-062c)
	RenderAs   string             `json:"renderAs,omitempty"`  // subunit: schematic symbol (FR-013b)
	Width      int                `json:"width"`               // unit only: outline width in grid units (>0)
	Height     int                `json:"height"`              // unit only: outline height in grid units (>0)
	Pins       []Pin              `json:"pins"`                // FR-062, FR-062a
	PinGroups  []PinGroup         `json:"pinGroups,omitempty"` // optional (FR-063)
	Delays     map[string]float64 `json:"delays,omitempty"`    // optional propagation delays, ns (FR-064)
	Behavior   string             `json:"behavior,omitempty"`  // GALasm text, captured verbatim (FR-066); evaluated client-side (FR-079)
	Clock      string             `json:"clock,omitempty"`     // optional clock input pin for .R behavior outputs (FR-062d)
	Gal        string             `json:"gal,omitempty"`       // optional GAL device selecting strict dialect (FR-066a); "" = extended (FR-079a)

	// Documentation (FR-104): optional, presentation-only. Copied through to the
	// properties panel (FR-105); never affects geometry, pins, or simulation.
	Description string     `json:"description,omitempty"` // one-line function summary
	Datasheet   *Datasheet `json:"datasheet,omitempty"`   // datasheet provenance + link
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
