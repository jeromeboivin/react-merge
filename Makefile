# Build and install React Merge on Linux.
#
#   make                      build the app (dist/linux-unpacked)
#   make install              install for the current user (~/.local)
#   sudo make install PREFIX=/usr/local
#   make uninstall            remove what install added (same PREFIX)
#   make clean                remove build output
#
# Needs Node.js 22 or later on PATH (e.g. `nvm use 22`).

APP      := react-merge
PREFIX   ?= $(HOME)/.local
DESTDIR  ?=

LIBDIR   := $(PREFIX)/lib/$(APP)
BINDIR   := $(PREFIX)/bin
DATADIR  := $(PREFIX)/share
ICONDIR  := $(DATADIR)/icons/hicolor
SIZES    := 16 22 24 32 48 64 128 256 512

UNPACKED := dist/linux-unpacked

SOURCES  := $(shell find src resources -type f) package.json electron.vite.config.ts \
            electron-builder.yml tsconfig.json tsconfig.node.json tsconfig.web.json

.PHONY: all install uninstall clean check-node

all: $(UNPACKED)/$(APP)

check-node:
	@command -v node >/dev/null || { echo "Node.js is not on PATH (try: nvm use 22)"; exit 1; }
	@node -e "process.exit(+process.versions.node.split('.')[0] >= 22 ? 0 : 1)" || \
		{ echo "Node.js 22 or later is required (found $$(node --version); try: nvm use 22)"; exit 1; }

node_modules/.package-lock.json: package.json package-lock.json | check-node
	npm ci
	@# The Electron runtime comes from its install script, which npm may skip.
	@test -x node_modules/electron/dist/electron || node node_modules/electron/install.js
	@touch $@

$(UNPACKED)/$(APP): node_modules/.package-lock.json $(SOURCES) | check-node
	npm run build
	npx electron-builder --linux dir --publish never \
		-c.electronDist=node_modules/electron/dist
	@touch $@

install: all
	install -d $(DESTDIR)$(LIBDIR) $(DESTDIR)$(BINDIR) $(DESTDIR)$(DATADIR)/applications
	rm -rf $(DESTDIR)$(LIBDIR)
	cp -a $(UNPACKED) $(DESTDIR)$(LIBDIR)
	@# A system install can use Chromium's sandbox: make its helper setuid root.
	@if [ "$$(id -u)" = 0 ]; then \
		chown root:root $(DESTDIR)$(LIBDIR)/chrome-sandbox && \
		chmod 4755 $(DESTDIR)$(LIBDIR)/chrome-sandbox; fi
	@# Launcher. Chromium's sandbox helper must be setuid root to be used; without it (a user
	@# install), the app runs with --no-sandbox.
	printf '%s\n' \
		'#!/bin/sh' \
		'dir="$(LIBDIR)"' \
		'if [ -u "$$dir/chrome-sandbox" ]; then exec "$$dir/$(APP)" "$$@"; fi' \
		'exec "$$dir/$(APP)" --no-sandbox "$$@"' > $(DESTDIR)$(BINDIR)/$(APP)
	chmod 755 $(DESTDIR)$(BINDIR)/$(APP)
	printf '%s\n' \
		'[Desktop Entry]' \
		'Type=Application' \
		'Name=React Merge' \
		'GenericName=Diff and Merge Tool' \
		'Comment=Compare two files or merge three' \
		'Exec=$(BINDIR)/$(APP) %F' \
		'Icon=$(APP)' \
		'Terminal=false' \
		'Categories=Development;' \
		'Keywords=diff;merge;compare;conflict;' \
		'StartupWMClass=$(APP)' > $(DESTDIR)$(DATADIR)/applications/$(APP).desktop
	chmod 644 $(DESTDIR)$(DATADIR)/applications/$(APP).desktop
	for s in $(SIZES); do \
		install -D -m 644 resources/icons/linux/$${s}x$${s}.png \
			$(DESTDIR)$(ICONDIR)/$${s}x$${s}/apps/$(APP).png; \
	done
	@if [ -z "$(DESTDIR)" ]; then \
		gtk-update-icon-cache -q -t $(ICONDIR) 2>/dev/null || true; \
		update-desktop-database -q $(DATADIR)/applications 2>/dev/null || true; fi
	@echo "Installed. Run: $(BINDIR)/$(APP) [files]"

uninstall:
	rm -rf $(DESTDIR)$(LIBDIR)
	rm -f $(DESTDIR)$(BINDIR)/$(APP) $(DESTDIR)$(DATADIR)/applications/$(APP).desktop
	for s in $(SIZES); do rm -f $(DESTDIR)$(ICONDIR)/$${s}x$${s}/apps/$(APP).png; done
	@if [ -z "$(DESTDIR)" ]; then \
		gtk-update-icon-cache -q -t $(ICONDIR) 2>/dev/null || true; \
		update-desktop-database -q $(DATADIR)/applications 2>/dev/null || true; fi

clean:
	rm -rf out dist
