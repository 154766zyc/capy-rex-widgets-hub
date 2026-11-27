#!/bin/sh
# Input via stdin only; no filesystem mounts and no Docker socket in container.
exec timeout -k 2s 10s docker run --rm -i --network none --read-only --cap-drop ALL --security-opt no-new-privileges --pids-limit 32 --memory 160m --memory-swap 160m --cpus .5 --ulimit nofile=64:64 capy-rex-validator:V1.3 node --max-old-space-size=96 validator/check.mjs
