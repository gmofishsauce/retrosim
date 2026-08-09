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

// ErrImportCollision is returned when a block import would overwrite something
// (FR-121j): a destination file that already exists, or an imported component
// type whose id is already in the destination project or the shared library.
// The error message lists every collision found, since the whole plan is
// preflighted before anything is written. The API layer maps it to 409 (§6.4).
var ErrImportCollision = errors.New("import refused")

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

// ImportData names one data file (a ROM's content, a RAM's save file) to copy:
// its absolute source path and the destination path relative to the destination
// project root, preserved verbatim so the copied design's relative reference
// still resolves (FR-121g/FR-121j).
type ImportData struct {
	Src string `json:"src"`
	Rel string `json:"rel"`
}

// ImportSpec is the copy plan a block import executes (FR-121j, §6.5a). The
// client's closure walk (§6.19) produces it: this server never parses a design.
// Designs are absolute paths, each a root-level file of SrcProject; TypeIDs are
// the component type ids the closure's instances reference, of which only those
// defined by SrcProject's own components/ are copied.
type ImportSpec struct {
	SrcProject string       `json:"srcProject"`
	Dst        string       `json:"dst"`
	Designs    []string     `json:"designs"`
	Data       []ImportData `json:"data"`
	TypeIDs    []string     `json:"typeIds"`
}

// ImportResult names what an import wrote, destination-relative, plus the
// non-fatal reports the client posts to the message tray (FR-074).
type ImportResult struct {
	Designs    []string `json:"designs"`
	Data       []string `json:"data"`
	Components []string `json:"components"`
	Warnings   []string `json:"warnings"`
}

// copyPlanItem is one preflighted copy: an absolute source and a destination
// path relative to the destination project root.
type copyPlanItem struct {
	src string
	rel string
}

// ImportBlock copies a design and its dependency closure from one project into
// another (FR-121j, §6.5a). The plan arrives fully resolved — the client owns
// the save format and computed which files the block depends on — so this
// function's job is the half the client cannot do: resolving referenced type
// ids to the source project's component files, preflighting every collision,
// and copying byte-verbatim.
//
// Nothing is written until the whole plan validates: every destination must be
// free, and no imported type id may already exist in the destination project or
// the shared library (the create-endpoint collision scope, FR-007a/FR-121i).
// All collisions are reported together in one ErrImportCollision, so a single
// retry can address them all. A failure *during* the copy leaves what was
// written, the DuplicateProject precedent (FR-121f) — the client reports it.
func ImportBlock(lib *Library, spec ImportSpec) (ImportResult, error) {
	res := ImportResult{Designs: []string{}, Data: []string{}, Components: []string{}, Warnings: []string{}}

	src, err := existingDir(spec.SrcProject)
	if err != nil {
		return res, err
	}
	dst, err := existingDir(spec.Dst)
	if err != nil {
		return res, err
	}
	if src == dst {
		return res, fmt.Errorf("%s: source and destination are the same project: %w", dst, ErrInvalidPath)
	}
	if len(spec.Designs) == 0 {
		return res, fmt.Errorf("nothing to import: %w", ErrInvalidPath)
	}

	// Designs: each must be an existing regular file sitting directly in the
	// source project root (the flat-layout rule, FR-121/FR-121j — re-checked
	// here because a copy to the destination root only preserves same-folder
	// references).
	var designs []copyPlanItem
	for _, p := range spec.Designs {
		if !filepath.IsAbs(p) {
			return res, fmt.Errorf("%q: design path must be absolute: %w", p, ErrInvalidPath)
		}
		p = filepath.Clean(p)
		if filepath.Dir(p) != src {
			return res, fmt.Errorf("%s: not a root-level file of %s: %w", p, src, ErrInvalidPath)
		}
		if err := statRegular(p); err != nil {
			return res, err
		}
		designs = append(designs, copyPlanItem{src: p, rel: filepath.Base(p)})
	}

	// Data files keep their project-relative destination path (FR-121g), so a
	// relative path that escapes the project is refused rather than flattened.
	var data []copyPlanItem
	for _, d := range spec.Data {
		rel := filepath.Clean(d.Rel)
		if d.Rel == "" || filepath.IsAbs(rel) || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
			return res, fmt.Errorf("%q: data destination must be a path inside the project: %w", d.Rel, ErrInvalidPath)
		}
		if !filepath.IsAbs(d.Src) {
			return res, fmt.Errorf("%q: data source must be absolute: %w", d.Src, ErrInvalidPath)
		}
		if err := statRegular(d.Src); err != nil {
			return res, err
		}
		data = append(data, copyPlanItem{src: filepath.Clean(d.Src), rel: rel})
	}

	// Component types: only ids defined by the source project's own components/
	// need copying — a shared-library id is available in every project already
	// (FR-002/FR-121i). An id in neither tier is a warning, not an error: the
	// design file carries its own typeData copy (FR-057), so the import works
	// regardless; only the palette tile is missing.
	srcFiles, scanWarn := ProjectComponentFiles(src)
	for _, w := range scanWarn {
		res.Warnings = append(res.Warnings, "source project components/: "+w)
	}
	dstTypes, _ := ScanProjectComponents(dst)
	dstIDs := map[string]bool{}
	for _, t := range dstTypes {
		dstIDs[t.Key()] = true
	}
	var comps []copyPlanItem
	var collisions []string
	seenID := map[string]bool{}
	for _, id := range spec.TypeIDs {
		if seenID[id] {
			continue
		}
		seenID[id] = true
		fname, local := srcFiles[id]
		switch {
		case !local && lib.has(id):
			// Shared type: present here too, nothing to copy.
		case !local:
			res.Warnings = append(res.Warnings, fmt.Sprintf(
				"component type %q is in neither the shared library nor the source project's components/; the copied design carries its embedded type data", id))
		case lib.has(id):
			collisions = append(collisions, fmt.Sprintf("component id %q is already in the shared library", id))
		case dstIDs[id]:
			collisions = append(collisions, fmt.Sprintf("component id %q is already in this project", id))
		default:
			comps = append(comps, copyPlanItem{
				src: filepath.Join(src, "components", fname),
				rel: filepath.Join("components", fname),
			})
		}
	}

	// Destination preflight: nothing may be overwritten, and no destination may
	// be claimed twice by one plan.
	plan := append(append(append([]copyPlanItem{}, designs...), data...), comps...)
	claimed := map[string]bool{}
	for _, it := range plan {
		if claimed[it.rel] {
			collisions = append(collisions, fmt.Sprintf("%s: named twice in one import", it.rel))
			continue
		}
		claimed[it.rel] = true
		switch _, err := os.Stat(filepath.Join(dst, it.rel)); {
		case err == nil:
			collisions = append(collisions, fmt.Sprintf("%s already exists in this project", it.rel))
		case !os.IsNotExist(err):
			return res, err
		}
	}
	if len(collisions) > 0 {
		return res, fmt.Errorf("%w: %s", ErrImportCollision, strings.Join(collisions, "; "))
	}

	for _, group := range []struct {
		items []copyPlanItem
		out   *[]string
	}{{designs, &res.Designs}, {data, &res.Data}, {comps, &res.Components}} {
		for _, it := range group.items {
			target := filepath.Join(dst, it.rel)
			if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
				return res, err
			}
			if err := copyFile(it.src, target); err != nil {
				return res, err // partial destination left, per FR-121j/FR-121f
			}
			*group.out = append(*group.out, it.rel)
		}
	}
	return res, nil
}

// existingDir validates an absolute path that must name an existing directory,
// returning it cleaned (the shared entry check of the import endpoint).
func existingDir(path string) (string, error) {
	if path == "" || !filepath.IsAbs(path) {
		return "", fmt.Errorf("%q: %w", path, ErrInvalidPath)
	}
	path = filepath.Clean(path)
	st, err := os.Stat(path)
	if err != nil {
		return "", err
	}
	if !st.IsDir() {
		return "", fmt.Errorf("%s: %w", path, ErrNotDir)
	}
	return path, nil
}

// statRegular reports whether path names an existing non-directory file.
func statRegular(path string) error {
	st, err := os.Stat(path)
	if err != nil {
		return err
	}
	if st.IsDir() {
		return fmt.Errorf("%s: is a directory: %w", path, ErrInvalidPath)
	}
	return nil
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
