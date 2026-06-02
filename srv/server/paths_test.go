package server

import "testing"

func TestAppDataDir(t *testing.T) {
	env := func(m map[string]string) func(string) string {
		return func(k string) string { return m[k] }
	}

	tests := []struct {
		name    string
		goos    string
		getenv  func(string) string
		home    string
		want    string
		wantErr bool
	}{
		{
			name: "darwin",
			goos: "darwin",
			home: "/Users/jeff",
			want: "/Users/jeff/Library/Application Support/wut4-editor",
		},
		{
			name:   "linux without XDG_DATA_HOME",
			goos:   "linux",
			getenv: env(nil),
			home:   "/home/jeff",
			want:   "/home/jeff/.local/share/wut4-editor",
		},
		{
			name:   "linux with absolute XDG_DATA_HOME",
			goos:   "linux",
			getenv: env(map[string]string{"XDG_DATA_HOME": "/custom/data"}),
			home:   "/home/jeff",
			want:   "/custom/data/wut4-editor",
		},
		{
			name:   "linux ignores relative XDG_DATA_HOME",
			goos:   "linux",
			getenv: env(map[string]string{"XDG_DATA_HOME": "relative/data"}),
			home:   "/home/jeff",
			want:   "/home/jeff/.local/share/wut4-editor",
		},
		{
			name:   "windows with APPDATA",
			goos:   "windows",
			getenv: env(map[string]string{"APPDATA": `C:\Users\jeff\AppData\Roaming`}),
			want:   `C:\Users\jeff\AppData\Roaming\wut4-editor`,
		},
		{
			name:    "windows without APPDATA errors",
			goos:    "windows",
			getenv:  env(nil),
			wantErr: true,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			getenv := tc.getenv
			if getenv == nil {
				getenv = func(string) string { return "" }
			}
			got, err := appDataDir(tc.goos, getenv, tc.home)
			if tc.wantErr {
				if err == nil {
					t.Fatalf("appDataDir() error = nil, want error")
				}
				return
			}
			if err != nil {
				t.Fatalf("appDataDir() unexpected error: %v", err)
			}
			if got != tc.want {
				t.Fatalf("appDataDir() = %q, want %q", got, tc.want)
			}
		})
	}
}
