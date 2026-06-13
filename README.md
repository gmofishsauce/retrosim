# retrosim

A full featured digital Simulator including user interface and generator for simulation engine. I know the world has many of these but I'm going to make this one just the way I like it.

retrosim is a localhost-only schematic editor: a JavaScript single-page app
(`web/`) served by a small Go server (`srv/`).

## Building

Requires Go 1.24 or later. Build the server binary from the `srv/` module:

```sh
(cd srv && go build -o ../retrosim ./cmd/retrosim)
```

This produces the `retrosim` executable in the repository root.

## Running

Start the server from the repository root, pointing it at the web assets and
component library:

```sh
./retrosim --web-dir=./web --components-dir=./srv/components
```

It binds `127.0.0.1:8137` only (loopback). Open <http://127.0.0.1:8137> in a
modern desktop Chrome or Firefox to use the editor. By default designs are saved
in `~/Documents/retrosim` (created if absent).

The `build-run` script does both steps — clean-rebuild then run — and forwards
any extra flags to the server:

```sh
./build-run
```

## Documentation

See the [user manual](docs/user.md) for how to use the editor: building and
running, the canvas selection model, wiring and buses, files, the Refresh
button, the built-in components, and simulation.
