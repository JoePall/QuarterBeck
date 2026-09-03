const vscode = require('vscode');

async function fetchIssues() {
  const cfg = vscode.workspace.getConfiguration('quarterbeck');
  const base = cfg.get('jira.baseUrl');
  const token = cfg.get('jira.apiToken');
  if (!base || !token) return [];
  // Minimal Jira API call would go here. For the MVP return an empty list if not configured.
  try {
    // in a full implementation use fetch/axios and basic auth with email:apiToken
    return [];
  } catch (e) {
    return [];
  }
}

module.exports = { fetchIssues };
