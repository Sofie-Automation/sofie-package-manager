#!/bin/sh
set -e

HOSTNAME=$(hostname)

node dist/index.js --workerId=$HOSTNAME $*