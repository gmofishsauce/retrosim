package server

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestIsManifestName(t *testing.T) {
	yes := []string{
		"foo-manifest.json",
		"Foo-Manifest.JSON",
		"a-b-manifest.json",
		"x-MANIFEST.json",
	}
	no := []string{
		"manifest.json", // no prefix ending in "-"
		"design.json",
		"foo-manifest.json.bak",
		"foo-manifest",
		"",
	}
	for _, n := range yes {
		if !IsManifestName(n) {
			t.Errorf("IsManifestName(%q) = false, want true", n)
		}
	}
	for _, n := range no {
		if IsManifestName(n) {
			t.Errorf("IsManifestName(%q) = true, want false", n)
		}
	}
}

func writeFile(t *testing.T, dir, name, content string) {
	t.Helper()
	if err := os.WriteFile(filepath.Join(dir, name), []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

func TestFindManifest(t *testing.T) {
	dir := t.TempDir()

	// None.
	file, extras, err := FindManifest(dir)
	if err != nil || file != "" || len(extras) != 0 {
		t.Fatalf("empty dir: got (%q, %v, %v), want (\"\", [], nil)", file, extras, err)
	}

	// One, plus non-matches (including a directory whose name matches).
	writeFile(t, dir, "b-manifest.json", "{}")
	writeFile(t, dir, "design.json", "{}")
	if err := os.Mkdir(filepath.Join(dir, "sub-manifest.json"), 0o755); err != nil {
		t.Fatal(err)
	}
	file, extras, err = FindManifest(dir)
	if err != nil || file != "b-manifest.json" || len(extras) != 0 {
		t.Fatalf("one manifest: got (%q, %v, %v)", file, extras, err)
	}

	// Several: first in sorted order recognized, rest extras.
	writeFile(t, dir, "a-manifest.json", "{}")
	writeFile(t, dir, "c-manifest.json", "{}")
	file, extras, err = FindManifest(dir)
	if err != nil || file != "a-manifest.json" {
		t.Fatalf("several manifests: got (%q, %v, %v)", file, extras, err)
	}
	if len(extras) != 2 || extras[0] != "b-manifest.json" || extras[1] != "c-manifest.json" {
		t.Fatalf("extras = %v, want [b-manifest.json c-manifest.json]", extras)
	}
}

func TestProjectInfoNoManifest(t *testing.T) {
	dir := t.TempDir()
	info, err := ProjectInfo(dir)
	if err != nil {
		t.Fatal(err)
	}
	if info.Name != filepath.Base(dir) {
		t.Errorf("Name = %q, want folder base %q", info.Name, filepath.Base(dir))
	}
	if info.ManifestFile != "" || info.MainDesign != "" || len(info.Warnings) != 0 {
		t.Errorf("unexpected info: %+v", info)
	}
}

func TestProjectInfoManifest(t *testing.T) {
	dir := t.TempDir()
	writeFile(t, dir, "proj-manifest.json",
		`{"formatVersion":1,"name":"My CPU","mainDesign":"cpu.json","future":42}`)
	writeFile(t, dir, "cpu.json", "{}")

	info, err := ProjectInfo(dir)
	if err != nil {
		t.Fatal(err)
	}
	if info.Name != "My CPU" || info.MainDesign != "cpu.json" || info.ManifestFile != "proj-manifest.json" {
		t.Errorf("info = %+v", info)
	}
	if len(info.Warnings) != 0 {
		t.Errorf("warnings = %v, want none", info.Warnings)
	}
}

func TestProjectInfoDanglingMainDesign(t *testing.T) {
	dir := t.TempDir()
	writeFile(t, dir, "p-manifest.json", `{"formatVersion":1,"name":"P","mainDesign":"gone.json"}`)

	info, err := ProjectInfo(dir)
	if err != nil {
		t.Fatal(err)
	}
	if info.MainDesign != "" {
		t.Errorf("MainDesign = %q, want cleared", info.MainDesign)
	}
	if len(info.Warnings) != 1 || !strings.Contains(info.Warnings[0], "gone.json") {
		t.Errorf("warnings = %v, want one naming gone.json", info.Warnings)
	}
}

func TestProjectInfoUnparseableManifest(t *testing.T) {
	dir := t.TempDir()
	writeFile(t, dir, "p-manifest.json", `{not json`)

	info, err := ProjectInfo(dir)
	if err != nil {
		t.Fatal(err)
	}
	if info.Name != filepath.Base(dir) {
		t.Errorf("Name = %q, want folder-base fallback", info.Name)
	}
	if info.ManifestFile != "p-manifest.json" {
		t.Errorf("ManifestFile = %q, want p-manifest.json", info.ManifestFile)
	}
	if len(info.Warnings) != 1 {
		t.Errorf("warnings = %v, want one parse warning", info.Warnings)
	}
}

func TestProjectInfoExtraManifests(t *testing.T) {
	dir := t.TempDir()
	writeFile(t, dir, "a-manifest.json", `{"name":"A"}`)
	writeFile(t, dir, "b-manifest.json", `{"name":"B"}`)

	info, err := ProjectInfo(dir)
	if err != nil {
		t.Fatal(err)
	}
	if info.Name != "A" || info.ManifestFile != "a-manifest.json" {
		t.Errorf("info = %+v, want a-manifest.json recognized", info)
	}
	if len(info.Warnings) != 1 || !strings.Contains(info.Warnings[0], "b-manifest.json") {
		t.Errorf("warnings = %v, want one naming b-manifest.json", info.Warnings)
	}
}

func TestCreateProject(t *testing.T) {
	parent := t.TempDir()
	path := filepath.Join(parent, "myproj")

	info, err := CreateProject(path)
	if err != nil {
		t.Fatal(err)
	}
	if info.Name != "myproj" || info.ManifestFile != "myproj-manifest.json" || info.MainDesign != "" {
		t.Errorf("info = %+v", info)
	}
	data, err := os.ReadFile(filepath.Join(path, "myproj-manifest.json"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(data), `"formatVersion"`) || !strings.Contains(string(data), `"myproj"`) {
		t.Errorf("manifest content: %s", data)
	}

	// Existing path → ErrProjectExists.
	if _, err := CreateProject(path); !errors.Is(err, ErrProjectExists) {
		t.Errorf("existing path err = %v, want ErrProjectExists", err)
	}
	// Missing parent → ErrInvalidPath.
	if _, err := CreateProject(filepath.Join(parent, "no", "such")); !errors.Is(err, ErrInvalidPath) {
		t.Errorf("missing parent err = %v, want ErrInvalidPath", err)
	}
	// Relative path → ErrInvalidPath.
	if _, err := CreateProject("relative/proj"); !errors.Is(err, ErrInvalidPath) {
		t.Errorf("relative path err = %v, want ErrInvalidPath", err)
	}
}

func TestDuplicateProject(t *testing.T) {
	parent := t.TempDir()
	src := filepath.Join(parent, "orig")
	if err := os.Mkdir(src, 0o755); err != nil {
		t.Fatal(err)
	}
	writeFile(t, src, "orig-manifest.json",
		`{"formatVersion":1,"name":"Original","mainDesign":"cpu.json","custom":"kept"}`)
	writeFile(t, src, "cpu.json", `{"name":"cpu"}`)
	writeFile(t, src, "alu.json", `{"name":"alu"}`)
	writeFile(t, src, "stray-manifest.json", `{"name":"stray"}`)
	if err := os.Mkdir(filepath.Join(src, "components"), 0o755); err != nil {
		t.Fatal(err)
	}
	writeFile(t, filepath.Join(src, "components"), "part.yaml", "id: type-x\n")

	dst := filepath.Join(parent, "copy")
	info, err := DuplicateProject(src, dst)
	if err != nil {
		t.Fatal(err)
	}
	if info.Name != "copy" || info.MainDesign != "cpu.json" {
		t.Errorf("info = %+v", info)
	}
	// Files copied verbatim, subdirectory preserved.
	for _, f := range []string{"cpu.json", "alu.json", "stray-manifest.json", "components/part.yaml"} {
		want, _ := os.ReadFile(filepath.Join(src, f))
		got, err := os.ReadFile(filepath.Join(dst, filepath.FromSlash(f)))
		if err != nil || string(got) != string(want) {
			t.Errorf("%s: copy mismatch (err %v)", f, err)
		}
	}
	// Recognized manifest renamed and rewritten: name = new base, other keys kept.
	if _, err := os.Stat(filepath.Join(dst, "orig-manifest.json")); !os.IsNotExist(err) {
		t.Error("orig-manifest.json copied verbatim, want renamed")
	}
	var m map[string]any
	data, err := os.ReadFile(filepath.Join(dst, "copy-manifest.json"))
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(data, &m); err != nil {
		t.Fatal(err)
	}
	if m["name"] != "copy" || m["mainDesign"] != "cpu.json" || m["custom"] != "kept" {
		t.Errorf("rewritten manifest = %v", m)
	}

	// Existing dst → ErrProjectExists; missing src → IsNotExist.
	if _, err := DuplicateProject(src, dst); !errors.Is(err, ErrProjectExists) {
		t.Errorf("existing dst err = %v, want ErrProjectExists", err)
	}
	if _, err := DuplicateProject(filepath.Join(parent, "gone"), filepath.Join(parent, "d2")); !os.IsNotExist(err) {
		t.Errorf("missing src err = %v, want IsNotExist", err)
	}
}

func TestDuplicateProjectUnparseableManifest(t *testing.T) {
	parent := t.TempDir()
	src := filepath.Join(parent, "orig")
	if err := os.Mkdir(src, 0o755); err != nil {
		t.Fatal(err)
	}
	writeFile(t, src, "orig-manifest.json", `{broken`)
	writeFile(t, src, "cpu.json", `{}`)

	dst := filepath.Join(parent, "copy")
	info, err := DuplicateProject(src, dst)
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, w := range info.Warnings {
		if strings.Contains(w, "orig-manifest.json") {
			found = true
		}
	}
	if !found {
		t.Errorf("warnings = %v, want one naming orig-manifest.json", info.Warnings)
	}
	var m map[string]any
	data, err := os.ReadFile(filepath.Join(dst, "copy-manifest.json"))
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(data, &m); err != nil {
		t.Fatalf("fresh manifest unparseable: %v", err)
	}
	if m["name"] != "copy" {
		t.Errorf("fresh manifest = %v", m)
	}
}

func TestDuplicateProjectNoManifest(t *testing.T) {
	parent := t.TempDir()
	src := filepath.Join(parent, "orig")
	if err := os.Mkdir(src, 0o755); err != nil {
		t.Fatal(err)
	}
	writeFile(t, src, "cpu.json", `{}`)

	dst := filepath.Join(parent, "copy")
	info, err := DuplicateProject(src, dst)
	if err != nil {
		t.Fatal(err)
	}
	// A manifest-less source stays manifest-less (the manifest is optional).
	if info.Name != "copy" || info.ManifestFile != "" {
		t.Errorf("info = %+v", info)
	}
	if len(info.Warnings) != 0 {
		t.Errorf("warnings = %v, want none", info.Warnings)
	}
}

func TestProjectInfoErrors(t *testing.T) {
	if _, err := ProjectInfo("relative/dir"); !errors.Is(err, ErrInvalidPath) {
		t.Errorf("relative dir err = %v, want ErrInvalidPath", err)
	}
	if _, err := ProjectInfo(filepath.Join(t.TempDir(), "missing")); !os.IsNotExist(err) {
		t.Errorf("missing dir err = %v, want IsNotExist", err)
	}
	f := filepath.Join(t.TempDir(), "file.json")
	if err := os.WriteFile(f, []byte("{}"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := ProjectInfo(f); !errors.Is(err, ErrNotDir) {
		t.Errorf("file err = %v, want ErrNotDir", err)
	}
}

// --- Block import (FR-121j) ---

// importFixture builds a source project holding two designs, a ROM file, and a
// project-local component type, plus an empty destination project.
func importFixture(t *testing.T) (src, dst string) {
	t.Helper()
	parent := t.TempDir()
	src = filepath.Join(parent, "alu-project")
	dst = filepath.Join(parent, "cpu-project")
	for _, d := range []string{src, dst} {
		if err := os.Mkdir(d, 0o755); err != nil {
			t.Fatal(err)
		}
	}
	writeFile(t, src, "alu.json", `{"name":"alu"}`)
	writeFile(t, src, "adder.json", `{"name":"adder"}`)
	writeFile(t, src, "rom.bin", "\x00\x01\x02")
	writeProjectComponent(t, src, "decode.yaml", galPartYAML)
	return src, dst
}

// planFor is the copy plan importFixture's source supports.
func planFor(src, dst string, typeIDs ...string) ImportSpec {
	return ImportSpec{
		SrcProject: src,
		Dst:        dst,
		Designs:    []string{filepath.Join(src, "alu.json"), filepath.Join(src, "adder.json")},
		Data:       []ImportData{{Src: filepath.Join(src, "rom.bin"), Rel: "rom.bin"}},
		TypeIDs:    typeIDs,
	}
}

// The whole plan copies byte-verbatim: designs at the destination root, data at
// its rel, the project-local YAML under components/ (created on demand). A
// shared-library id copies nothing silently; an id in neither tier warns
// (FR-121j).
func TestImportBlockCopies(t *testing.T) {
	src, dst := importFixture(t)
	res, err := ImportBlock(testLibrary(), planFor(src, dst, "type-PC-DECODE-A", "type-7400", "type-NOWHERE"))
	if err != nil {
		t.Fatal(err)
	}
	want := map[string]string{
		"alu.json":               `{"name":"alu"}`,
		"adder.json":             `{"name":"adder"}`,
		"rom.bin":                "\x00\x01\x02",
		"components/decode.yaml": galPartYAML,
	}
	for rel, content := range want {
		got, err := os.ReadFile(filepath.Join(dst, filepath.FromSlash(rel)))
		if err != nil {
			t.Fatalf("%s: %v", rel, err)
		}
		if string(got) != content {
			t.Errorf("%s content = %q, want %q", rel, got, content)
		}
	}
	if len(res.Designs) != 2 || len(res.Data) != 1 || len(res.Components) != 1 {
		t.Errorf("result = %+v", res)
	}
	if len(res.Warnings) != 1 || !strings.Contains(res.Warnings[0], "type-NOWHERE") {
		t.Errorf("warnings = %v, want exactly one naming type-NOWHERE", res.Warnings)
	}
}

// Every collision is reported together and nothing is written (FR-121j).
func TestImportBlockCollisionsRefuseWholePlan(t *testing.T) {
	src, dst := importFixture(t)
	writeFile(t, dst, "alu.json", "pre-existing")
	writeProjectComponent(t, dst, "already-here.yaml", galPartYAML) // same id, other name

	spec := planFor(src, dst, "type-PC-DECODE-A")
	spec.Designs = append(spec.Designs, filepath.Join(src, "adder.json")) // named twice
	_, err := ImportBlock(testLibrary(), spec)
	if !errors.Is(err, ErrImportCollision) {
		t.Fatalf("err = %v, want ErrImportCollision", err)
	}
	for _, want := range []string{"alu.json already exists", "type-PC-DECODE-A", "named twice"} {
		if !strings.Contains(err.Error(), want) {
			t.Errorf("error %q missing %q", err, want)
		}
	}
	// Nothing copied: the untouched files are still absent and the collided one
	// keeps its content.
	for _, rel := range []string{"adder.json", "rom.bin"} {
		if _, err := os.Stat(filepath.Join(dst, rel)); !os.IsNotExist(err) {
			t.Errorf("%s: got %v, want not to exist", rel, err)
		}
	}
	if b, _ := os.ReadFile(filepath.Join(dst, "alu.json")); string(b) != "pre-existing" {
		t.Errorf("alu.json = %q, want the destination's own content", b)
	}
}

// An imported project-local type may not shadow a shared-library one — the
// create-endpoint collision scope (FR-007a/FR-121i/FR-121j).
func TestImportBlockRefusesSharedLibraryShadow(t *testing.T) {
	src, dst := importFixture(t)
	writeProjectComponent(t, src, "shadow.yaml", `id: "type-7400"
type: "7400"
pins:
  - { name: A, side: left, pos: 1, dir: in }
`)
	_, err := ImportBlock(testLibrary(), planFor(src, dst, "type-7400"))
	if !errors.Is(err, ErrImportCollision) || !strings.Contains(err.Error(), "shared library") {
		t.Fatalf("err = %v, want an ErrImportCollision naming the shared library", err)
	}
}

// Malformed plans are rejected before anything is written (FR-121j).
func TestImportBlockRejectsBadPlans(t *testing.T) {
	src, dst := importFixture(t)
	sub := filepath.Join(src, "sub")
	if err := os.Mkdir(sub, 0o755); err != nil {
		t.Fatal(err)
	}
	writeFile(t, sub, "deep.json", "{}")

	cases := map[string]ImportSpec{
		"no designs":       {SrcProject: src, Dst: dst},
		"src == dst":       {SrcProject: src, Dst: src, Designs: []string{filepath.Join(src, "alu.json")}},
		"missing src dir":  {SrcProject: filepath.Join(src, "gone"), Dst: dst, Designs: []string{filepath.Join(src, "alu.json")}},
		"design in subdir": {SrcProject: src, Dst: dst, Designs: []string{filepath.Join(sub, "deep.json")}},
		"missing design":   {SrcProject: src, Dst: dst, Designs: []string{filepath.Join(src, "gone.json")}},
		"relative design":  {SrcProject: src, Dst: dst, Designs: []string{"alu.json"}},
		"escaping data": {SrcProject: src, Dst: dst, Designs: []string{filepath.Join(src, "alu.json")},
			Data: []ImportData{{Src: filepath.Join(src, "rom.bin"), Rel: "../rom.bin"}}},
		"absolute data rel": {SrcProject: src, Dst: dst, Designs: []string{filepath.Join(src, "alu.json")},
			Data: []ImportData{{Src: filepath.Join(src, "rom.bin"), Rel: filepath.Join(dst, "rom.bin")}}},
	}
	for name, spec := range cases {
		if _, err := ImportBlock(testLibrary(), spec); err == nil {
			t.Errorf("%s: err = nil, want a rejection", name)
		}
	}
	if entries, _ := os.ReadDir(dst); len(entries) != 0 {
		t.Errorf("destination = %v, want nothing written", entries)
	}
}
