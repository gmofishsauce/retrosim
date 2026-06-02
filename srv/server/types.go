// Package server holds the wut4-editor HTTP server: the component library, the
// MD parser, design storage, and the REST API. This file defines the component
// library data model (design.md §7.1), shared by the in-memory library, the
// /api/v1/components response, and the full-copy embedded in saved designs
// (FR-057).
package server

// ComponentType is one TTL component definition, parsed from an MD file
// (FR-062). width/height are always concrete grid-unit dimensions once parsed
// (stated, derived from pins, or resolved from a package — §6.3).
type ComponentType struct {
	Name      string             `json:"name"`                // unique type name, e.g. "74138"
	Package   string             `json:"package,omitempty"`   // optional declared package, e.g. "DIP-16" (FR-062b)
	Width     int                `json:"width"`               // outline width in grid units (>0)
	Height    int                `json:"height"`              // outline height in grid units (>0)
	Pins      []Pin              `json:"pins"`                // FR-062, FR-062a
	PinGroups []PinGroup         `json:"pinGroups,omitempty"` // optional (FR-063)
	Delays    map[string]float64 `json:"delays,omitempty"`    // optional propagation delays, ns (FR-064)
	Behavior  string             `json:"behavior,omitempty"`  // opaque GALasm text, preserved & ignored (FR-066)
}

// Pin is one connection point on a component's outline (FR-062, FR-062a).
type Pin struct {
	Name      string `json:"name"`             // e.g. "A0", "/Y3"
	Side      string `json:"side"`             // "left" | "right" | "top" | "bottom" (FR-014)
	Position  int    `json:"position"`         // grid units along the side from its origin
	Direction string `json:"direction"`        // "in" | "out" | "bidir" | "tristate" (FR-062a)
	Width     int    `json:"width"`            // bit-width, default 1
	Number    *int   `json:"number,omitempty"` // optional physical pin number (FR-062b)
}

// PinGroup is a named, ordered set of pins forming a bus interface for
// snap-connection (FR-063). Group bit-width = sum of member pin widths.
type PinGroup struct {
	Name string   `json:"name"` // e.g. "A", "DATA"
	Pins []string `json:"pins"` // ordered member pin names (bit order)
}
