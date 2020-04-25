# Defining shell is necessary in order to modify PATH
SHELL := sh
export PATH := node_modules/.bin/:$(PATH)

ESLINT_FLAGS := --cache --report-unused-disable-directives --fix --ext .ts

# This will look up all the files in utils/githooks and generate a list of targets
GITFILES := $(patsubst utils/githooks/%, .git/hooks/%, $(wildcard utils/githooks/*))

# The `githooks` dependency should be added to the first (default) target so that it will be
# executed when invoking make with no arguments
all: githooks

githooks: $(GITFILES)

# Default target for all possible git hooks
.git/hooks/%: utils/githooks/%
	cp $< $@

test:
	NODE_ENV=test jest --runInBand

infra:
	docker-compose up -d

lint:
	eslint $(ESLINT_FLAGS) .

compile:
	tsc

.PHONY: test infra lint
