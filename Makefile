# Defining shell is necessary in order to modify PATH
SHELL := sh
export PATH := node_modules/.bin/:$(PATH)

# On CI servers, use the `npm ci` installer to avoid introducing changes to the package-lock.json
# On developer machines, prefer the generally more flexible `npm install`. 💪
NPM_I := $(if $(CI), ci, install)

ESLINT_FLAGS := --cache --report-unused-disable-directives --fix --ext .ts

# This will look up all the files in utils/githooks and generate a list of targets
GITFILES := $(patsubst utils/githooks/%, .git/hooks/%, $(wildcard utils/githooks/*))

# The `githooks` dependency should be added to the first (default) target so that it will be
# executed when invoking make with no arguments
all: githooks

# GENERIC TARGETS

node_modules: package.json
	npm $(NPM_I) && touch node_modules

githooks: $(GITFILES)

# Default target for all possible git hooks
.git/hooks/%: utils/githooks/%
	cp $< $@

# TASK DEFINITIONS
install: node_modules $(GITFILES)

compile:
	tsc

test: compile
	node ./dist/test/worker.js && NODE_ENV=test jest --runInBand

infra:
	docker-compose up -d

lint:
	eslint $(ESLINT_FLAGS) .

.PHONY: test infra lint
