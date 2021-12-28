#!/bin/bash
set -eo pipefail

# In this repository we define `TokenStaking` contract which overlaps
# with the contract artifact from `@keep-network/keep-core`. We want to
# use both artifacts in the deployment scripts, so we have to rename
# the artifact imported from `@keep-network/keep-core`.
#
# This is a workaround for hardhat-deploy plugin limitation:
# https://github.com/wighawag/hardhat-deploy/issues/241

printf "Preparing dependencies artifacts\n"

# If scripts is invoked in other projects during NPM package dependency installation
# it may be needed to specify path for the module (e.g. when using Yarn).
ROOT_DIR=${1:-$(realpath $(dirname $0)/../)}

printf "Root directory: $ROOT_DIR\n"

SOURCE_DIR="$ROOT_DIR/node_modules/@keep-network/keep-core/artifacts"
DESTINATION_DIR="$ROOT_DIR/external/npm/@keep-network/keep-core"

printf "Source directory: $SOURCE_DIR\n"
printf "Destination directory: $DESTINATION_DIR\n"

mkdir -p $DESTINATION_DIR
cp -r $SOURCE_DIR $DESTINATION_DIR

SOURCE_FILE="$DESTINATION_DIR/artifacts/TokenStaking.json"
DESTINATION_FILE="$DESTINATION_DIR/artifacts/KeepTokenStaking.json"

if [ -f "$SOURCE_FILE" ]; then
  mv $SOURCE_FILE $DESTINATION_FILE
else
  echo "artifact for @keep-network/keep-core/TokenStaking.json not found"
fi
