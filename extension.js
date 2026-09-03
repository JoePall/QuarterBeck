const vscode = require('vscode');
const cp = require('child_process');
const fs = require('fs');
const path = require('path');

function makeId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2,8);
}

function getWorkspaceRoot() {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    throw new Error('No workspace folder open. QuarterBeck requires an open workspace with a git repo.');
  }
  return folders[0].uri.fsPath;
}

function loadSessions(root) {
  const p = path.join(root, '.quarterbeck', 'sessions.json');
  if (!fs.existsSync(p)) return [];
  try { return JSON.parse(fs.readFileSync(p,'utf8')); } catch (e) { return []; }
}

function saveSessions(root, sessions) {
  const dir = path.join(root, '.quarterbeck');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'sessions.json'), JSON.stringify(sessions, null, 2));
}

async function createWorktree(root, branchName) {
  const worktreesDir = path.join(root, '.quarterbeck', 'worktrees');
  fs.mkdirSync(worktreesDir, { recursive: true });
  const worktreePath = path.join(worktreesDir, branchName);
  const cmd = `git worktree add -b ${branchName} "${worktreePath}" HEAD`;
  cp.execSync(cmd, { cwd: root });
  return worktreePath;
}

async function hasChanges(worktreePath) {
  try {
    const out = cp.execSync('git status --porcelain', { cwd: worktreePath }).toString().trim();
    return out.length > 0;
  } catch (e) { return false; }
}

async function commitAll(worktreePath, message) {
  try {
    cp.execSync('git add -A', { cwd: worktreePath });
    cp.execSync(`git commit -m "${message.replace(/\"/g,'\\\"')}"`, { cwd: worktreePath });
    return true;
  } catch (e) {
    return false;
  }
}

async function openCopilotWithContext(issue) {
  const config = vscode.workspace.getConfiguration('quarterbeck');
  const attempts = config.get('copilot.commandPriority') || [];
  for (const cmd of attempts) {
    try {
      // some copilot commands accept args, some do not. We attempt to call without args first.
      await vscode.commands.executeCommand(cmd);
      // If it seems to have opened, show a hint to paste the context
      vscode.window.showInformationMessage('Copilot Chat opened — paste the issue context into the chat (if Copilot supports programmatic context, adjust settings).');
      return true;
    } catch (e) {
      // ignore and try next
    }
  }
  vscode.window.showWarningMessage('Could not open Copilot Chat. Ensure Copilot Chat is installed and configure quarterbeck.copilot.commandPriority to the right command names.');
  return false;
}

async function startSessionForIssue(issue) {
  const root = getWorkspaceRoot();
  const sessions = loadSessions(root);
  const id = makeId();
  const branch = `quarterbeck/session-${id}`;
  const wt = await createWorktree(root, branch);
  const session = { id, issue, branch, worktreePath: wt, createdAt: new Date().toISOString(), finished: false, committed: false };
  sessions.push(session);
  saveSessions(root, sessions);
  return session;
}

async function finishSession(sessionId) {
  const root = getWorkspaceRoot();
  const sessions = loadSessions(root);
  const s = sessions.find(x => x.id === sessionId);
  if (!s) throw new Error('Session not found');
  const changed = await hasChanges(s.worktreePath);
  if (changed) {
    const ok = await commitAll(s.worktreePath, `QuarterBeck: session changes for ${s.issue.key || s.issue.id || 'issue'}`);
    s.committed = ok;
  }
  s.finished = true;
  s.finishedAt = new Date().toISOString();
  saveSessions(root, sessions);
  return s;
}

async function listSessions() {
  const root = getWorkspaceRoot();
  return loadSessions(root);
}

function getWebviewHtml(context) {
  const htmlPath = path.join(context.extensionPath, 'src', 'webview', 'panel.html');
  if (fs.existsSync(htmlPath)) return fs.readFileSync(htmlPath, 'utf8');
  return `<!doctype html><html><body><h3>QuarterBeck</h3><div>No panel installed.</div></body></html>`;
}

function activate(context) {
  context.subscriptions.push(vscode.commands.registerCommand('quarterbeck.openIssuesPanel', async () => {
    const panel = vscode.window.createWebviewPanel('quarterbeckIssues','QuarterBeck Issues',vscode.ViewColumn.One,{enableScripts:true});
    panel.webview.html = getWebviewHtml(context);

    panel.webview.onDidReceiveMessage(async msg => {
      try {
        if (msg.command === 'fetchIssues') {
          // Ask adapters for issues
          const jira = require('./src/adapters/jiraAdapter');
          const monday = require('./src/adapters/mondayAdapter');
          const issues = [];
          try { issues.push(...(await jira.fetchIssues())); } catch (e) { /* ignore */ }
          try { issues.push(...(await monday.fetchIssues())); } catch (e) { /* ignore */ }
          panel.webview.postMessage({ command: 'issues', issues });
        }
        if (msg.command === 'startChat') {
          const session = await startSessionForIssue(msg.issue);
          await openCopilotWithContext(msg.issue);
          panel.webview.postMessage({ command: 'sessionStarted', session });
        }
        if (msg.command === 'finishSession') {
          const s = await finishSession(msg.sessionId);
          panel.webview.postMessage({ command: 'sessionFinished', session: s });
        }
      } catch (err) {
        panel.webview.postMessage({ command: 'error', message: String(err) });
      }
    });
  }));

  context.subscriptions.push(vscode.commands.registerCommand('quarterbeck.createPRFromSession', async () => {
    try {
      const sessions = await listSessions();
      if (!sessions || sessions.length === 0) return vscode.window.showInformationMessage('No QuarterBeck sessions found');
      const picks = sessions.map(s => ({ label: s.id, description: s.issue.summary || s.issue.title || '', detail: s.branch, session: s }));
      const pick = await vscode.window.showQuickPick(picks, { placeHolder: 'Select a session to create a PR from' });
      if (!pick) return;
      const s = pick.session;
      // If not committed, try to commit
      if (!s.committed) {
        const changed = await hasChanges(s.worktreePath);
        if (changed) {
          const ok = await commitAll(s.worktreePath, `QuarterBeck: session changes for ${s.issue.key || s.issue.id || 'issue'}`);
          s.committed = ok;
        }
      }
      // Construct PR compare URL
      const repo = await vscode.commands.executeCommand('git.api.getRepository');
      // As a fallback, try environment
      const folder = getWorkspaceRoot();
      // We'll call into the GitHub repo info via REST to find default branch using the extension host's network — we cannot here, so we will ask user to paste default. We'll provide a compare link template instead.
      const head = encodeURIComponent(s.branch);
      const owner = 'JoePall';
      const repoName = 'QuarterBeck';
      const basePlaceholder = 'main';
      const title = encodeURIComponent((s.issue.summary || s.issue.title || 'QuarterBeck session') + '');
      const url = `https://github.com/${owner}/${repoName}/compare/${basePlaceholder}...${head}?expand=1&title=${title}`;
      vscode.env.openExternal(vscode.Uri.parse(url));
      vscode.window.showInformationMessage('Opened GitHub compare page — please review and create the PR (push the branch if needed).');
    } catch (e) {
      vscode.window.showErrorMessage('Failed to create PR from session: ' + String(e));
    }
  }));
}

function deactivate() {}

module.exports = { activate, deactivate };
