package server

import (
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

// NewRouter builds the HTTP handler for the editor: the versioned REST API under
// /api/v1/ plus a static file handler serving the SPA from webDir (§6.4). All
// API routes live under the /api/v1/ prefix so new endpoints can be added later
// without breaking existing clients (NFR-004). dataDir is the default designs
// root reported by /defaults and used when a request omits an explicit path.
func NewRouter(lib *Library, dataDir, componentsDir, webDir string) http.Handler {
	mux := http.NewServeMux()

	api := http.NewServeMux()
	api.HandleFunc("/api/v1/components", handleComponents(lib, componentsDir))
	api.HandleFunc("/api/v1/defaults", handleDefaults(dataDir))
	api.HandleFunc("/api/v1/files", handleFiles(dataDir))
	api.HandleFunc("/api/v1/romfile", handleRomFile())
	api.HandleFunc("/api/v1/design/load", handleDesignLoad())
	api.HandleFunc("/api/v1/design/save", handleDesignSave())
	api.HandleFunc("/api/v1/ping", handlePing())
	// Any other /api/ path is an API miss: answer with a JSON envelope, never
	// the static handler's HTML.
	api.HandleFunc("/api/", func(w http.ResponseWriter, r *http.Request) {
		writeError(w, http.StatusNotFound, "no such endpoint: "+r.URL.Path)
	})

	static := http.FileServer(http.Dir(webDir))

	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/api/") {
			api.ServeHTTP(w, r)
			return
		}
		// This is a localhost-only authoring tool served straight from the source
		// tree (§6.4); never let the browser cache the SPA assets, so edits show up
		// on a plain reload without a hard-refresh or DevTools cache toggle.
		w.Header().Set("Cache-Control", "no-store")
		static.ServeHTTP(w, r)
	})
	return mux
}

// handlePing answers the client's connection heartbeat (FR-089). No side
// effects; reachability is the entire payload.
func handlePing() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !requireMethod(w, r, http.MethodGet) {
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"ok": true})
	}
}

// handleComponents serves the parsed component library on GET (FR-065) and
// creates a new component on POST (FR-007a). POST parses the submitted YAML with
// the same validation as a startup load, persists it into componentsDir under a
// part-number-derived filename, adds it to the live library, and returns it so
// the client can add the tile without a restart.
func handleComponents(lib *Library, componentsDir string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet:
			writeJSON(w, http.StatusOK, map[string]any{"components": lib.List()})
		case http.MethodPost:
			var body struct {
				YAML string `json:"yaml"`
			}
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				writeError(w, http.StatusBadRequest, "invalid request body")
				return
			}
			comp, err := lib.Create(componentsDir, []byte(body.YAML))
			switch {
			case err == nil:
				writeJSON(w, http.StatusCreated, map[string]any{"component": comp})
			case errors.Is(err, ErrDuplicateComponent):
				writeError(w, http.StatusConflict, err.Error())
			case errors.Is(err, ErrComponentWrite):
				log.Printf("api: create component: %v", err)
				writeError(w, http.StatusInternalServerError, "could not write component")
			default:
				// Parse/validation failure: a client (authoring) error.
				writeError(w, http.StatusBadRequest, err.Error())
			}
		default:
			writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		}
	}
}

// handleDefaults reports server defaults, currently the designs root (FR-050).
func handleDefaults(dataDir string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !requireMethod(w, r, http.MethodGet) {
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"dataDir": dataDir})
	}
}

// handleFiles lists a directory for the file-navigation dialog (FR-052/FR-053).
// An empty path query defaults to the designs root.
func handleFiles(dataDir string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !requireMethod(w, r, http.MethodGet) {
			return
		}
		path := r.URL.Query().Get("path")
		if path == "" {
			path = dataDir
		}
		if !filepath.IsAbs(path) {
			writeError(w, http.StatusBadRequest, "path must be absolute")
			return
		}
		// Optional comma-separated extension filter (FR-114e ROM picker passes
		// "bin,hex"); absent → ListDir's default *.json (designs).
		var exts []string
		if q := r.URL.Query().Get("exts"); q != "" {
			exts = strings.Split(q, ",")
		}
		listing, err := ListDir(path, exts...)
		if err != nil {
			writeStorageError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, listing)
	}
}

// handleRomFile serves a ROM content file's raw bytes for the simulator's
// Run-time loader (FR-114e). The path must be absolute and end in .bin or .hex;
// the client parses the bytes per the extension. Capped at MaxRomBytes by
// ReadFileBytes.
func handleRomFile() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !requireMethod(w, r, http.MethodGet) {
			return
		}
		path := r.URL.Query().Get("path")
		if path == "" || !filepath.IsAbs(path) {
			writeError(w, http.StatusBadRequest, "path must be a non-empty absolute path")
			return
		}
		switch strings.ToLower(filepath.Ext(path)) {
		case ".bin", ".hex":
		default:
			writeError(w, http.StatusBadRequest, "ROM file must be .bin or .hex")
			return
		}
		data, err := ReadFileBytes(path)
		if err != nil {
			writeStorageError(w, err)
			return
		}
		w.Header().Set("Content-Type", "application/octet-stream")
		w.WriteHeader(http.StatusOK)
		w.Write(data)
	}
}

// handleDesignLoad reads a design file and returns it verbatim (FR-052).
func handleDesignLoad() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !requireMethod(w, r, http.MethodGet) {
			return
		}
		path := r.URL.Query().Get("path")
		if path == "" || !filepath.IsAbs(path) {
			writeError(w, http.StatusBadRequest, "path must be a non-empty absolute path")
			return
		}
		design, err := LoadDesign(path)
		if err != nil {
			writeStorageError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"design": design})
	}
}

// handleDesignSave writes a design file atomically (FR-046–FR-049).
func handleDesignSave() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !requireMethod(w, r, http.MethodPost) {
			return
		}
		var body struct {
			Path   string          `json:"path"`
			Design json.RawMessage `json:"design"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeError(w, http.StatusBadRequest, "invalid request body")
			return
		}
		if err := SaveDesign(body.Path, body.Design); err != nil {
			writeStorageError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"path": body.Path})
	}
}

// requireMethod writes a 405 envelope and returns false if the method is wrong.
func requireMethod(w http.ResponseWriter, r *http.Request, method string) bool {
	if r.Method != method {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return false
	}
	return true
}

// writeStorageError maps a storage-layer error to its HTTP status (§6.4) and
// logs the full detail server-side.
func writeStorageError(w http.ResponseWriter, err error) {
	var status int
	switch {
	case errors.Is(err, ErrInvalidPath):
		status = http.StatusBadRequest
	case errors.Is(err, ErrNotDir):
		status = http.StatusForbidden
	case os.IsNotExist(err):
		status = http.StatusNotFound
	case errors.Is(err, ErrMalformedJSON):
		status = http.StatusUnprocessableEntity
	default:
		status = http.StatusInternalServerError
	}
	log.Printf("api: %v", err)
	writeError(w, status, err.Error())
}

// writeJSON encodes v as the response body with the given status.
func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(v); err != nil {
		log.Printf("api: encode response: %v", err)
	}
}

// writeError emits the consistent error envelope {"error":"<message>"} (§6.4).
// The message is for the local UI; full detail is logged server-side.
func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}
