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
	ErrInvalidPath   = errors.New("invalid path")              // empty or non-absolute
	ErrNotDir        = errors.New("not a directory")           // ListDir on a file
	ErrMalformedJSON = errors.New("malformed JSON")            // unparseable design file
	ErrBadMemExt     = errors.New("file must be .bin or .hex") // RAM/ROM path with wrong extension
	ErrTooLarge      = errors.New("file too large")            // RAM write over MaxRomBytes
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

// MaxRomBytes caps a ROM content file the server will read (FR-114e): a
// 2^24-location × 32-bit device is 64 MiB, the largest a generated ROM can use.
const MaxRomBytes = 64 << 20

// ListDir lists a directory's subdirectories and the files whose extension is in
// `exts` (FR-053); with no `exts` it defaults to *.json (designs). The ROM-file
// picker (FR-114e) passes .bin/.hex. Matches are case-insensitive; each ext may
// be given with or without its leading dot.
func ListDir(path string, exts ...string) (DirListing, error) {
	if len(exts) == 0 {
		exts = []string{".json"}
	}
	allow := make(map[string]bool, len(exts))
	for _, e := range exts {
		if e != "" && e[0] != '.' {
			e = "." + e
		}
		allow[strings.ToLower(e)] = true
	}

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
		if allow[strings.ToLower(filepath.Ext(it.Name()))] {
			entries = append(entries, DirEntry{Name: it.Name(), IsDir: false})
		}
	}

	return DirListing{Path: path, Parent: filepath.Dir(path), Entries: entries}, nil
}

// ReadFileBytes reads a file's raw bytes for the ROM loader (FR-114e), capped at
// MaxRomBytes. path must be absolute. A missing file is returned unwrapped so
// os.IsNotExist maps to 404; an over-size file is a plain error (500).
func ReadFileBytes(path string) ([]byte, error) {
	if path == "" || !filepath.IsAbs(path) {
		return nil, fmt.Errorf("%q: %w", path, ErrInvalidPath)
	}
	info, err := os.Stat(path)
	if err != nil {
		return nil, err
	}
	if info.IsDir() {
		return nil, fmt.Errorf("%s: %w", path, ErrNotDir)
	}
	if info.Size() > MaxRomBytes {
		return nil, fmt.Errorf("%s: file too large (%d bytes, max %d)", path, info.Size(), MaxRomBytes)
	}
	return os.ReadFile(path)
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

// SaveFile writes verbatim text to path atomically (same temp-file+rename as
// SaveDesign, §6.5) with no interpretation of the content. Added for the C
// generator's delivery (§6.4/§6.17, FR-116): generated C source is not JSON,
// so it cannot ride SaveDesign's json.Indent path. path must be absolute.
func SaveFile(path string, content []byte) error {
	if path == "" || !filepath.IsAbs(path) {
		return fmt.Errorf("%q: %w", path, ErrInvalidPath)
	}
	return atomicWrite(path, content)
}

// WriteRamFile writes a RAM persistent-content file's bytes to path atomically
// (FR-114g), the write analogue of ReadFileBytes/handleRomFile. path must be
// absolute and end in .bin or .hex; the client has already formatted the bytes
// per the extension (raw binary, or ASCII hex tokens). Over-size content is
// rejected with ErrTooLarge (the same MaxRomBytes cap as the ROM read).
func WriteRamFile(path string, data []byte) error {
	if path == "" || !filepath.IsAbs(path) {
		return fmt.Errorf("%q: %w", path, ErrInvalidPath)
	}
	switch strings.ToLower(filepath.Ext(path)) {
	case ".bin", ".hex":
	default:
		return fmt.Errorf("%s: %w", path, ErrBadMemExt)
	}
	if len(data) > MaxRomBytes {
		return fmt.Errorf("%s: %d bytes, max %d: %w", path, len(data), MaxRomBytes, ErrTooLarge)
	}
	return atomicWrite(path, data)
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
