package server

import (
	"fmt"
	"os"
	"runtime"
)

// appDirName is the editor's folder inside the user's documents directory.
const appDirName = "wut4-editor"

// DesignsDir returns the default designs directory — appDirName inside the
// user's documents folder — creating it if absent (FR-050). It is a thin
// wrapper over the pure, table-tested designsDir seam. (Reworked 2026-06-12;
// supersedes AppDataDir and its per-OS app-data locations — designs are user
// documents.)
func DesignsDir() (string, error) {
	home, _ := os.UserHomeDir()
	dir, err := designsDir(runtime.GOOS, os.Getenv, home)
	if err != nil {
		return "", err
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	return dir, nil
}

// designsDir computes the designs directory for the given OS, without touching
// the filesystem, so every branch is deterministically testable. Paths are
// built with the target OS's separator regardless of the host OS.
//
//   - darwin:  <home>/Documents/wut4-editor
//   - windows: %USERPROFILE%\Documents\wut4-editor (error if USERPROFILE is unset)
//   - other:   <home>/Documents/wut4-editor
func designsDir(goos string, getenv func(string) string, home string) (string, error) {
	switch goos {
	case "windows":
		profile := getenv("USERPROFILE")
		if profile == "" {
			return "", fmt.Errorf("USERPROFILE is not set")
		}
		return profile + `\Documents\` + appDirName, nil
	default: // darwin, linux, …
		return home + "/Documents/" + appDirName, nil
	}
}
