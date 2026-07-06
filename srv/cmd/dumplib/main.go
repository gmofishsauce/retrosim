// Command dumplib prints the parsed component library as JSON — the same
// ComponentType array the /api/v1/components endpoint serves (FR-065) — so
// offline tooling can consume the library without a running server. The
// consumer is web/tools/refresh-types.js (batch Refresh Types, FR-088).
//
// Usage: dumplib [dir]   (dir defaults to "components", i.e. run from srv/)
//
// Parse failures are logged and skipped exactly as at server startup (§6.2);
// the log goes to stderr, keeping stdout pure JSON.
package main

import (
	"encoding/json"
	"fmt"
	"os"

	"github.com/gmofishsauce/retrosim/sim/srv/server"
)

func main() {
	dir := "components"
	if len(os.Args) > 1 {
		dir = os.Args[1]
	}
	lib, err := server.LoadLibrary(dir)
	if err != nil {
		fmt.Fprintln(os.Stderr, "dumplib:", err)
		os.Exit(1)
	}
	enc := json.NewEncoder(os.Stdout)
	enc.SetIndent("", "  ")
	if err := enc.Encode(lib.List()); err != nil {
		fmt.Fprintln(os.Stderr, "dumplib:", err)
		os.Exit(1)
	}
}
