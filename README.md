# QuarterBeck VS Code extension (MVP)

This repository branch contains a minimal VS Code extension (MVP) that integrates issue tiles from Jira and Monday, wires up to Copilot Chat, and creates session worktrees for isolated edits.

Quick overview
- Commands:
  - QuarterBeck: Open Issues Panel
  - QuarterBeck: Create PR from Session
- Sessions are stored in .quarterbeck/sessions.json and worktrees are created under .quarterbeck/worktrees

Limitations / Notes
- This MVP uses the system git CLI to create worktrees and commit changes. Ensure git is installed and the workspace is a git repository.
- The extension will NOT push branches to remotes (user-push mode). After creating a branch locally via a session, push it using your git remote.
- Copilot Chat may require adjusting the quarterbeck.copilot.commandPriority setting; the extension will try the commands in order.

Local testing
1. npm install (no external deps required for this MVP)
2. Open in VS Code and run the extension in Extension Development Host
3. Run command: QuarterBeck: Open Issues Panel

Security
- Do NOT commit API tokens to source control. Configure them in your user or workspace settings.

