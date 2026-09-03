const vscode = require('vscode');

async function fetchIssues() {
  const cfg = vscode.workspace.getConfiguration('quarterbeck');
  const token = cfg.get('monday.apiToken');
  if (!token) return [];
  // Minimal Monday.com GraphQL call would go here. For the MVP return an empty list if not configured.
  try { return []; } catch (e) { return []; }
}

module.exports = { fetchIssues };
