# ADR-0013: Single application instance

## Status
Accepted

## Context
Two GameHub processes on the same `userData` would contend for the SQLite file
and Chromium partition directories.

## Decision
Call `app.requestSingleInstanceLock()` before anything else; if it fails, quit.
A second launch focuses the existing window (`second-instance` event).

Tests use distinct `userData` directories, so they are unaffected.
