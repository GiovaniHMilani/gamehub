# GameHub

Electron desktop application for managing multiple isolated web-game accounts.

## Status

Initial architecture/bootstrap stage.

## First development goal

Build the smallest vertical slice:

1. Create one Game.
2. Create one GameAccount.
3. Create one persistent GameInstance.
4. Mount it using WebContentsView.
5. Persist its browser session.
6. Restart the app and restore the session.
7. Add a second account of the same game.
8. Verify browser state isolation.

Do not build the full UI before this architecture is proven.

## Claude Code

Read `CLAUDE.md` before making changes.

The custom multi-instance browser architecture is documented in:

`.claude/skills/multi-instance-browser/SKILL.md`
