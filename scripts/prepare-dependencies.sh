#!/bin/bash
set -eo pipefail

# In this repository we define `TokenStaking` contract which overlaps
# with the contract artifact from `@keep-network/keep-core`. We want to
# use both artifacts in the deployment scripts, so we have to rename
# the artifact imported from `@keep-network/keep-core`.
#
# This is a workaround for hardhat-deploy plugin limitation:
# https://github.com/wighawag/hardhat-deploy/issues/241

SOURCE_DIR="node_modules/@keep-network/keep-core/artifacts"
DESTINATION_DIR="external/npm/@keep-network/keep-core"

mkdir -p $DESTINATION_DIR
cp -r $SOURCE_DIR $DESTINATION_DIR

SOURCE_FILE="$DESTINATION_DIR/artifacts/TokenStaking.json"
DESTINATION_FILE="$DESTINATION_DIR/artifacts/KeepTokenStaking.json"

if [ -f "$SOURCE_FILE" ]; then
  mv $SOURCE_FILE $DESTINATION_FILE
else
  echo "artifact for @keep-network/keep-core/TokenStaking.json not found"
fi
