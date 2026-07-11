// Command retrosim is the localhost-only HTTP server for the TTL circuit
// design editor (design.md §6.1): it parses flags, refuses any non-loopback
// bind address (NFR-001), loads the YAML component library, and serves the
// API endpoints and static SPA via server.NewRouter.
package main

import (
	"flag"
	"log"
	"net"
	"net/http"

	"github.com/gmofishsauce/retrosim/sim/srv/server"
)

func main() {
	addr := flag.String("addr", "127.0.0.1:8137", "loopback host:port to bind (must be loopback)")
	componentsDir := flag.String("components-dir", "./components", "YAML component library directory")
	dataDir := flag.String("data-dir", "", "designs root (default: <documents dir>/retrosim)")
	webDir := flag.String("web-dir", "./web", "static SPA assets directory")
	flag.Parse()

	if err := requireLoopback(*addr); err != nil {
		log.Fatalf("retrosim: %v", err)
	}

	if *dataDir == "" {
		d, err := server.DesignsDir()
		if err != nil {
			log.Fatalf("retrosim: resolving data dir: %v", err)
		}
		*dataDir = d
	}
	log.Printf("retrosim: data dir %s", *dataDir)

	lib, err := server.LoadLibrary(*componentsDir)
	if err != nil {
		log.Fatalf("retrosim: loading components: %v", err)
	}

	srv := &http.Server{Addr: *addr, Handler: server.NewRouter(lib, *dataDir, *componentsDir, *webDir)}

	log.Printf("retrosim: listening on http://%s", *addr)
	if err := srv.ListenAndServe(); err != nil {
		log.Fatalf("retrosim: %v", err)
	}
}

// requireLoopback returns an error unless addr's host is a loopback address
// (NFR-001). A missing host (e.g. ":8137", which binds all interfaces) is
// rejected.
func requireLoopback(addr string) error {
	host, _, err := net.SplitHostPort(addr)
	if err != nil {
		return err
	}
	if host == "localhost" {
		return nil
	}
	ip := net.ParseIP(host)
	if ip == nil || !ip.IsLoopback() {
		return &addrError{addr: addr}
	}
	return nil
}

type addrError struct{ addr string }

func (e *addrError) Error() string {
	return "refusing non-loopback --addr " + e.addr + " (server binds 127.0.0.1 only)"
}
