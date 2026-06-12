package server

import "testing"

func TestDesignsDir(t *testing.T) {
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
			want: "/Users/jeff/Documents/wut4-editor",
		},
		{
			name: "linux",
			goos: "linux",
			home: "/home/jeff",
			want: "/home/jeff/Documents/wut4-editor",
		},
		{
			name:   "windows with USERPROFILE",
			goos:   "windows",
			getenv: env(map[string]string{"USERPROFILE": `C:\Users\jeff`}),
			want:   `C:\Users\jeff\Documents\wut4-editor`,
		},
		{
			name:    "windows without USERPROFILE errors",
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
			got, err := designsDir(tc.goos, getenv, tc.home)
			if tc.wantErr {
				if err == nil {
					t.Fatalf("designsDir() error = nil, want error")
				}
				return
			}
			if err != nil {
				t.Fatalf("designsDir() unexpected error: %v", err)
			}
			if got != tc.want {
				t.Fatalf("designsDir() = %q, want %q", got, tc.want)
			}
		})
	}
}
