package server

import (
	"fmt"
	"os"
	"runtime"
	"strings"
)

// appDirName is the per-OS application data subdirectory for the editor.
const appDirName = "wut4-editor"

// AppDataDir returns the platform-standard application data directory for the
// editor's designs, creating it if absent (FR-050, OQ-006). It is a thin wrapper
// over the pure, table-tested appDataDir seam.
func AppDataDir() (string, error) {
	home, _ := os.UserHomeDir()
	dir, err := appDataDir(runtime.GOOS, os.Getenv, home)
	if err != nil {
		return "", err
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	return dir, nil
}

// appDataDir computes the application data directory for the given OS, without
// touching the filesystem, so every branch is deterministically testable
// (OQ-006). Paths are built with the target OS's separator regardless of the
// host OS.
//
//   - darwin:  <home>/Library/Application Support/wut4-editor
//   - windows: %APPDATA%\wut4-editor   (error if APPDATA is unset)
//   - other:   $XDG_DATA_HOME/wut4-editor if XDG_DATA_HOME is absolute,
//     else <home>/.local/share/wut4-editor
func appDataDir(goos string, getenv func(string) string, home string) (string, error) {
	switch goos {
	case "darwin":
		return home + "/Library/Application Support/" + appDirName, nil
	case "windows":
		appData := getenv("APPDATA")
		if appData == "" {
			return "", fmt.Errorf("APPDATA is not set")
		}
		return appData + `\` + appDirName, nil
	default:
		if xdg := getenv("XDG_DATA_HOME"); strings.HasPrefix(xdg, "/") {
			return xdg + "/" + appDirName, nil
		}
		return home + "/.local/share/" + appDirName, nil
	}
}
