# 0002 - CI and Docker pinned Node below the pnpm floor

## Symptom

CI failed immediately in the "Set up Node" step with `ERR_UNKNOWN_BUILTIN_MODULE: node:sqlite`
and `This version of pnpm requires at least Node.js v22.13`. The Dockerfiles used `node:20-slim`
and would have failed the same way in the container. Everything passed locally.

## Root cause

The scaffold pinned Node 20 in CI and the Docker images to mirror canopy's `engines.node: >=20`,
but `pnpm@11.8.0` requires Node >= 22.13 (it uses the `node:sqlite` builtin added in Node 22).
The dev machine ran Node 26, so the mismatch was invisible locally and only surfaced in CI.

## Fix

Bumped CI and all three Dockerfiles to Node 22 and set `engines.node` to `>=22.13.0` to state
the real floor rather than an aspirational one.

## Learning

Pin the runtime to what the toolchain actually requires, not an aspirational lower bound. The
package manager's own Node floor is the hard minimum for CI and container images; "passes on my
machine" hides it when the local Node is newer than CI. When mirroring another repo's versions,
verify the combination runs on the target Node, not just that the numbers match.
