package server

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// Projects (FR-121 group, §6.5a): manifest discovery and tolerant parsing,
// project info resolution, project creation, and project duplication. All
// functions are stateless — every call takes the project directory; the server
// holds no open-project state (FR-121).

// ErrProjectExists is returned when a project create/duplicate destination
// already exists (FR-121b/FR-121f). The API layer maps it to 409 (§6.4).
var ErrProjectExists = errors.New("path already exists")

// manifestSuffix is the project-manifest filename pattern (FR-121a): any file
// at the project root ending in this suffix is a manifest, regardless of
// prefix, so renaming the folder outside the app never orphans it.
const manifestSuffix = "-manifest.json"

// Info is a project's resolved identity (§6.4 /project/info response shape).
// ManifestFile and MainDesign are "" when absent; Warnings carries the
// extra-manifest, unparseable-manifest, and dangling-mainDesign reports
// (FR-121a), which the client posts to the message tray (FR-074).
type Info struct {
	Dir          string   `json:"dir"`
	Name         string   `json:"name"`
	ManifestFile string   `json:"manifestFile"`
	MainDesign   string   `json:"mainDesign"`
	Warnings     []string `json:"warnings"`
}

// IsManifestName reports whether name matches the project-manifest pattern
// `*-manifest.json` (FR-121a), case-insensitively — consistent with ListDir's
// case-insensitive extension matching. Shared by handleFiles' listing filter
// (§6.4) and mirrored by the client's isManifestName (§6.19).
func IsManifestName(name string) bool {
	return strings.HasSuffix(strings.ToLower(name), manifestSuffix)
}

// FindManifest scans dir (non-recursively) for manifest filenames (FR-121a).
// Matches are sorted by filename; the first is the recognized manifest, the
// rest are returned as extras for the multiple-manifest report. file is ""
// when there is none.
func FindManifest(dir string) (file string, extras []string, err error) {
	items, err := os.ReadDir(dir)
	if err != nil {
		return "", nil, err
	}
	var matches []string
	for _, it := range items {
		if !it.IsDir() && IsManifestName(it.Name()) {
			matches = append(matches, it.Name())
		}
	}
	sort.Strings(matches)
	if len(matches) == 0 {
		return "", nil, nil
	}
	return matches[0], matches[1:], nil
}

// ProjectInfo resolves a project directory's identity (FR-121a, §6.5a): its
// display name (the manifest's `name`, falling back to the folder's base
// name), its recognized manifest, and its main design. Manifest-content
// problems are warnings, never errors — a project must stay usable with a
// broken manifest. A recorded mainDesign whose file no longer exists in dir
// is cleared in the response with a warning (the dangling-main rule, checked
// here in one place).
func ProjectInfo(dir string) (Info, error) {
	if dir == "" || !filepath.IsAbs(dir) {
		return Info{}, fmt.Errorf("%q: %w", dir, ErrInvalidPath)
	}
	st, err := os.Stat(dir)
	if err != nil {
		return Info{}, err
	}
	if !st.IsDir() {
		return Info{}, fmt.Errorf("%s: %w", dir, ErrNotDir)
	}

	info := Info{Dir: dir, Name: filepath.Base(dir), Warnings: []string{}}

	file, extras, err := FindManifest(dir)
	if err != nil {
		return Info{}, err
	}
	if file == "" {
		return info, nil
	}
	info.ManifestFile = file
	for _, x := range extras {
		info.Warnings = append(info.Warnings,
			fmt.Sprintf("multiple project manifests: using %s, ignoring %s", file, x))
	}

	name, mainDesign, ok := parseManifest(filepath.Join(dir, file))
	if !ok {
		info.Warnings = append(info.Warnings,
			fmt.Sprintf("project manifest %s could not be parsed; using the folder name", file))
		return info, nil
	}
	if name != "" {
		info.Name = name
	}
	if mainDesign != "" {
		if _, err := os.Stat(filepath.Join(dir, mainDesign)); err != nil {
			info.Warnings = append(info.Warnings,
				fmt.Sprintf("project main design %s not found; ignoring it", mainDesign))
		} else {
			info.MainDesign = mainDesign
		}
	}
	return info, nil
}

// CreateProject creates a new project directory and its manifest (FR-121b,
// §6.5a): path must be absolute, its parent must exist (ErrInvalidPath
// otherwise), and the directory itself must not exist (ErrProjectExists).
// The manifest is written as <base>-manifest.json carrying
// {"formatVersion":1,"name":"<base>"} (FR-121a).
func CreateProject(path string) (Info, error) {
	if path == "" || !filepath.IsAbs(path) {
		return Info{}, fmt.Errorf("%q: %w", path, ErrInvalidPath)
	}
	if _, err := os.Stat(path); err == nil {
		return Info{}, fmt.Errorf("%s: %w", path, ErrProjectExists)
	}
	if _, err := os.Stat(filepath.Dir(path)); err != nil {
		return Info{}, fmt.Errorf("%s: parent directory: %w", path, ErrInvalidPath)
	}
	if err := os.Mkdir(path, 0o755); err != nil {
		return Info{}, err
	}
	base := filepath.Base(path)
	manifest := fmt.Sprintf("{\n  \"formatVersion\": 1,\n  \"name\": %s\n}\n", jsonString(base))
	if err := atomicWrite(filepath.Join(path, base+manifestSuffix), []byte(manifest)); err != nil {
		return Info{}, err
	}
	return ProjectInfo(path)
}

// DuplicateProject copies the entire project directory src to the new
// directory dst (FR-121f, §6.5a): every regular file byte-verbatim, with
// subdirectories preserved. The recognized manifest is not copied verbatim:
// it is parsed tolerantly, its `name` set to dst's base name, all other
// fields preserved, and written as <base(dst)>-manifest.json; an unparseable
// recognized manifest falls back to a fresh minimal manifest plus a warning
// in the returned Info. Extra manifests copy verbatim. A mid-copy failure
// returns the error and leaves the partial destination — no rollback; the
// client reports it for manual cleanup.
func DuplicateProject(src, dst string) (Info, error) {
	if src == "" || !filepath.IsAbs(src) {
		return Info{}, fmt.Errorf("%q: %w", src, ErrInvalidPath)
	}
	if dst == "" || !filepath.IsAbs(dst) {
		return Info{}, fmt.Errorf("%q: %w", dst, ErrInvalidPath)
	}
	st, err := os.Stat(src)
	if err != nil {
		return Info{}, err
	}
	if !st.IsDir() {
		return Info{}, fmt.Errorf("%s: %w", src, ErrNotDir)
	}
	if _, err := os.Stat(dst); err == nil {
		return Info{}, fmt.Errorf("%s: %w", dst, ErrProjectExists)
	}
	if _, err := os.Stat(filepath.Dir(dst)); err != nil {
		return Info{}, fmt.Errorf("%s: parent directory: %w", dst, ErrInvalidPath)
	}

	recognized, _, err := FindManifest(src)
	if err != nil {
		return Info{}, err
	}

	if err := os.Mkdir(dst, 0o755); err != nil {
		return Info{}, err
	}
	err = filepath.WalkDir(src, func(p string, d os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(src, p)
		if err != nil {
			return err
		}
		if rel == "." {
			return nil
		}
		if rel == recognized && recognized != "" {
			return nil // rewritten below, not copied verbatim
		}
		target := filepath.Join(dst, rel)
		if d.IsDir() {
			return os.Mkdir(target, 0o755)
		}
		return copyFile(p, target)
	})
	if err != nil {
		return Info{}, err // partial destination left, per FR-121f
	}

	// Write the destination manifest: the recognized source manifest with its
	// name rewritten, or — when the recognized manifest is unparseable — a
	// fresh minimal manifest plus a warning. A manifest-less source stays
	// manifest-less (the manifest is optional, FR-121a).
	base := filepath.Base(dst)
	var warn string
	if recognized != "" {
		m := map[string]any{}
		data, rerr := os.ReadFile(filepath.Join(src, recognized))
		if rerr != nil || json.Unmarshal(data, &m) != nil {
			m = map[string]any{}
			warn = fmt.Sprintf("source manifest %s could not be parsed; the duplicate got a fresh manifest", recognized)
		}
		if _, ok := m["formatVersion"]; !ok {
			m["formatVersion"] = 1
		}
		m["name"] = base
		data, err = json.MarshalIndent(m, "", "  ")
		if err != nil {
			return Info{}, err
		}
		if err := atomicWrite(filepath.Join(dst, base+manifestSuffix), append(data, '\n')); err != nil {
			return Info{}, err
		}
	}

	info, err := ProjectInfo(dst)
	if err != nil {
		return Info{}, err
	}
	if warn != "" {
		info.Warnings = append(info.Warnings, warn)
	}
	return info, nil
}

// copyFile copies one regular file byte-verbatim (symlinks followed as files —
// trusted local FS, §4.2).
func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.OpenFile(dst, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o644)
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, in); err != nil {
		out.Close()
		return err
	}
	return out.Close()
}

// jsonString renders s as a JSON string literal.
func jsonString(s string) string {
	b, _ := json.Marshal(s)
	return string(b)
}

// parseManifest reads a manifest tolerantly (§6.5a): decode into a generic
// map, take `name` and `mainDesign` when they are strings, ignore everything
// else. ok is false when the file cannot be read or decoded.
func parseManifest(path string) (name, mainDesign string, ok bool) {
	data, err := os.ReadFile(path)
	if err != nil {
		return "", "", false
	}
	var m map[string]any
	if err := json.Unmarshal(data, &m); err != nil {
		return "", "", false
	}
	name, _ = m["name"].(string)
	mainDesign, _ = m["mainDesign"].(string)
	return name, mainDesign, true
}
