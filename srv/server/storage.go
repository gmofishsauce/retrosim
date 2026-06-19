package server

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// Storage errors. The API layer maps these to HTTP statuses (§6.4).
var (
	ErrInvalidPath   = errors.New("invalid path")    // empty or non-absolute
	ErrNotDir        = errors.New("not a directory") // ListDir on a file
	ErrMalformedJSON = errors.New("malformed JSON")  // unparseable design file
)

// DirEntry is one item in a directory listing.
type DirEntry struct {
	Name  string `json:"name"`
	IsDir bool   `json:"isDir"`
}

// DirListing is the result of ListDir: the listed directory, its parent (so a
// file dialog can offer "up"), and the filtered entries (FR-053, §6.5).
type DirListing struct {
	Path    string     `json:"path"`
	Parent  string     `json:"parent"`
	Entries []DirEntry `json:"entries"`
}

// ListDir lists a directory's subdirectories and *.json files (FR-053). Only
// designs and navigable folders are returned; other files are omitted. The
// .json match is case-insensitive.
func ListDir(path string) (DirListing, error) {
	info, err := os.Stat(path)
	if err != nil {
		return DirListing{}, err
	}
	if !info.IsDir() {
		return DirListing{}, fmt.Errorf("%s: %w", path, ErrNotDir)
	}

	items, err := os.ReadDir(path)
	if err != nil {
		return DirListing{}, err
	}

	entries := make([]DirEntry, 0, len(items))
	for _, it := range items {
		if it.IsDir() {
			entries = append(entries, DirEntry{Name: it.Name(), IsDir: true})
			continue
		}
		if strings.EqualFold(filepath.Ext(it.Name()), ".json") {
			entries = append(entries, DirEntry{Name: it.Name(), IsDir: false})
		}
	}

	return DirListing{Path: path, Parent: filepath.Dir(path), Entries: entries}, nil
}

// LoadDesign reads and validates a design file (FR-052, FR-055). The raw JSON is
// returned verbatim; the server does not interpret the design (the SPA owns the
// schema). A read error (including a missing file) is returned unwrapped so
// os.IsNotExist works; unparseable content yields ErrMalformedJSON.
func LoadDesign(path string) (json.RawMessage, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	if !json.Valid(data) {
		return nil, fmt.Errorf("%s: %w", path, ErrMalformedJSON)
	}
	return json.RawMessage(data), nil
}

// SaveDesign writes a design to path atomically: it writes a temp file in the
// same directory, fsyncs it, and renames it over the destination, so a failure
// never truncates an existing design (FR-046–FR-049, §6.5). The design JSON is
// stored pretty-printed. path must be absolute.
func SaveDesign(path string, design json.RawMessage) error {
	if path == "" || !filepath.IsAbs(path) {
		return fmt.Errorf("%q: %w", path, ErrInvalidPath)
	}

	var pretty bytes.Buffer
	if err := json.Indent(&pretty, design, "", "  "); err != nil {
		return fmt.Errorf("%s: %w", err, ErrMalformedJSON)
	}
	pretty.WriteByte('\n')

	return atomicWrite(path, pretty.Bytes())
}

// atomicWrite writes data to path via a temp file in the same directory, fsynced
// and renamed over the destination, so a failure never truncates an existing file
// (§6.5). Shared by SaveDesign (FR-046–FR-049) and component create (FR-007a).
func atomicWrite(path string, data []byte) error {
	dir := filepath.Dir(path)
	tmp, err := os.CreateTemp(dir, ".retrosim-*.tmp")
	if err != nil {
		return err
	}
	tmpName := tmp.Name()
	defer os.Remove(tmpName) // no-op once renamed away

	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Sync(); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	if err := os.Chmod(tmpName, 0o644); err != nil {
		return err
	}
	return os.Rename(tmpName, path)
}
