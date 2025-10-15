#!/bin/sh
set -e

HOSTNAME=$(hostname)

# Inject a unique worker ID based on the hostname, and disable the appContainer connection
node dist/index.js --workerId=$HOSTNAME --appContainerURL="" $*