const $ = (selector, root = document) => root.querySelector(selector);
let state;
let toastTimer;
let readmeDirty = false;
const DRAFT_KEY = "leettrackReadmeDraft";

async function request(type, payload = {}) {
  const response = await chrome.runtime.sendMessage({ type, ...payload });
  if (!response?.ok) throw new Error(response?.error || "Could not complete that action.");
  return response.result;
}
function showToast(message) {
  const toast = $("#toast"); toast.textContent = message; toast.classList.add("show");
  clearTimeout(toastTimer); toastTimer = setTimeout(() => toast.classList.remove("show"), 2600);
}
function setMessage(node, message, kind = "") {
  node.textContent = message; node.className = "inline-message" + (kind ? " " + kind : "");
}
function setUploadMessage(message, kind = "", link = "") {
  const node = $("#upload-message"); node.replaceChildren(); node.className = "upload-message" + (kind ? " " + kind : "");
  node.append(document.createTextNode(message));
  if (link) {
    const anchor = document.createElement("a"); anchor.href = link; anchor.target = "_blank"; anchor.rel = "noreferrer";
    anchor.textContent = " View on GitHub ↗"; anchor.style.color = "#7456e8"; anchor.style.fontWeight = "700"; anchor.style.textDecoration = "none"; node.append(anchor);
  }
}
function appendInline(target, text) {
  const pattern = /\[([^\]]+)\]\((https?:\/\/[^)]+)\)|\*\*([^*]+)\*\*/g;
  let cursor = 0; let match;
  while ((match = pattern.exec(text))) {
    target.append(document.createTextNode(text.slice(cursor, match.index)));
    if (match[1]) {
      const link = document.createElement("a"); link.href = match[2]; link.target = "_blank"; link.rel = "noreferrer"; link.textContent = match[1]; target.append(link);
    } else {
      const strong = document.createElement("strong"); strong.textContent = match[3]; target.append(strong);
    }
    cursor = pattern.lastIndex;
  }
  target.append(document.createTextNode(text.slice(cursor)));
}
function renderMarkdown(markdown) {
  const host = $("#markdown-preview"); host.replaceChildren();
  const lines = String(markdown || "").replace(/\r/g, "").split("\n"); let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) { const node = document.createElement("h" + heading[1].length); appendInline(node, heading[2]); host.append(node); i++; continue; }
    if (/^\s*---+\s*$/.test(line)) { host.append(document.createElement("hr")); i++; continue; }
    if (/^\s*>/.test(line)) { const quote = document.createElement("blockquote"); appendInline(quote, line.replace(/^\s*>\s?/, "")); host.append(quote); i++; continue; }
    if (/^\s*\|/.test(line)) {
      const tableLines = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) tableLines.push(lines[i++]);
      const rows = tableLines.filter((row) => !/^\s*\|\s*:?-{2,}/.test(row)).map((row) => row.split("|").slice(1, -1).map((cell) => cell.trim()));
      if (rows.length) {
        const table = document.createElement("table"); const thead = document.createElement("thead"); const header = document.createElement("tr");
        rows[0].forEach((cell) => { const th = document.createElement("th"); appendInline(th, cell); header.append(th); });
        thead.append(header); table.append(thead);
        const tbody = document.createElement("tbody");
        rows.slice(1).forEach((row) => { const tr = document.createElement("tr"); row.forEach((cell) => { const td = document.createElement("td"); appendInline(td, cell); tr.append(td); }); tbody.append(tr); });
        table.append(tbody); host.append(table);
      }
      continue;
    }
    if (/^\s*[-*]\s+/.test(line)) {
      const list = document.createElement("ul");
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) { const li = document.createElement("li"); appendInline(li, lines[i++].replace(/^\s*[-*]\s+/, "")); list.append(li); }
      host.append(list); continue;
    }
    const parts = [line.trim()]; i++;
    while (i < lines.length && lines[i].trim() && !/^(#{1,3}\s|\s*>|\s*\||\s*[-*]\s+|\s*---+\s*$)/.test(lines[i])) parts.push(lines[i++].trim());
    const paragraph = document.createElement("p"); appendInline(paragraph, parts.join(" ")); host.append(paragraph);
  }
  if (!String(markdown || "").trim()) {
    const placeholder = document.createElement("div"); placeholder.className = "preview-placeholder";
    const icon = document.createElement("span"); icon.textContent = "▤";
    const title = document.createElement("strong"); title.textContent = "Your preview will appear here";
    const body = document.createElement("p"); body.textContent = "Choose a README file or generate one from your tracker.";
    placeholder.append(icon, title, body); host.append(placeholder);
  }
}
function updateEditor() {
  const content = $("#readme-content").value;
  $("#char-count").textContent = content.length.toLocaleString() + " characters";
  $("#upload-readme").disabled = !content.trim() || !state?.settings?.githubToken || !state?.settings?.githubRepo;
  renderMarkdown(content);
}
function updateConnectionUI() {
  const connected = Boolean(state?.settings?.githubToken && state?.settings?.githubRepo);
  const badge = $("#connection-badge"); badge.classList.toggle("connected", connected);
  badge.replaceChildren();
  const dot = document.createElement("i"); badge.append(dot, document.createTextNode(connected ? " Connected" : " Not connected"));
  const repo = state?.settings?.githubRepo || "";
  if (document.activeElement !== $("#repo-input")) $("#repo-input").value = repo;
  $("#publish-repo-label").textContent = connected ? repo : "Connect your GitHub destination to continue";
  $("#repo-shortcut").href = repo ? "https://github.com/" + repo : "#";
  $("#repo-shortcut").classList.toggle("hidden", !repo);
  if (document.activeElement !== $("#readme-path")) $("#readme-path").value = state?.settings?.readmePath || "README.md";
  $("#auto-update").checked = Boolean(state?.settings?.autoUpdateReadme);
  $("#sync-solutions").checked = Boolean(state?.settings?.syncSolutions);
  if (document.activeElement !== $("#solution-folder")) $("#solution-folder").value = state?.settings?.solutionFolder || "LeetCode";
  $("#daily-goal").value = state?.settings?.dailyGoal || 3;
  $("#upload-readme").disabled = !$("#readme-content").value.trim() || !connected;
  $("#import-solutions").disabled = !repo;
  if (connected && !$("#upload-message").classList.contains("success")) setUploadMessage("Ready to publish to " + repo + ".");
  if (!connected) setUploadMessage("Connect GitHub to enable publishing.");
}
function showSection(section) {
  const names = { github: "GitHub destination", readme: "README studio", data: "Your data" };
  document.querySelectorAll(".section-pane").forEach((pane) => pane.classList.toggle("hidden", pane.id !== "pane-" + section));
  document.querySelectorAll(".side-link").forEach((link) => link.classList.toggle("active", link.dataset.section === section));
  $("#page-title").textContent = names[section]; $("#breadcrumb-current").textContent = names[section].toUpperCase();
  $("#page-subtitle").textContent = section === "readme" ? "Preview your Markdown before you publish it." : section === "github" ? "Choose your own repository for optional solution and README sync." : "Back up, move, or tune your personal tracker.";
}
async function saveSettings(patch) {
  state = await request("SAVE_SETTINGS", { settings: patch }); updateConnectionUI(); return state;
}
function persistDraft() {
  chrome.storage.local.set({ [DRAFT_KEY]: $("#readme-content").value });
}
async function importReadmeFile(file) {
  if (!file) return;
  if (file.size > 1024 * 1024) { showToast("Please choose a file smaller than 1 MB."); return; }
  if (!/\.(md|markdown|txt)$/i.test(file.name)) { showToast("Choose a Markdown or text file."); return; }
  $("#readme-content").value = await file.text();
  $("#file-state").textContent = file.name; $("#file-state").classList.add("loaded");
  readmeDirty = true; updateEditor(); persistDraft();
  setUploadMessage("Preview the content, then publish it to " + (state.settings.githubRepo || "your repository") + ".");
  document.querySelectorAll(".step").forEach((step, index) => { step.classList.toggle("done", index === 0); step.classList.toggle("current", index === 1); });
}
function downloadJson(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = filename; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function init() {
  state = await request("GET_STATE");
  const savedDraft = await chrome.storage.local.get(DRAFT_KEY);
  if (typeof savedDraft[DRAFT_KEY] === "string" && savedDraft[DRAFT_KEY]) {
    $("#readme-content").value = savedDraft[DRAFT_KEY];
    $("#file-state").textContent = "Saved draft on this device";
    $("#file-state").classList.add("loaded");
    readmeDirty = true;
  }
  updateConnectionUI(); updateEditor();
  if (!state.settings.githubToken || !state.settings.githubRepo) setMessage($("#connect-message"), "Connect your GitHub destination to publish.");
  else setMessage($("#connect-message"), "Connected to " + state.settings.githubRepo + ".", "success");
}
document.addEventListener("click", async (event) => {
  const section = event.target.closest("[data-section]");
  if (section) { showSection(section.dataset.section); return; }
  if (event.target.closest("#show-token")) {
    const input = $("#token-input"); const showing = input.type === "text"; input.type = showing ? "password" : "text";
    event.target.textContent = showing ? "Show" : "Hide"; return;
  }
  if (event.target.closest("#choose-file")) { $("#readme-file").click(); return; }
  if (event.target.closest("#dropzone") && !event.target.closest("button")) { $("#readme-file").click(); return; }
  if (event.target.closest("#generate-readme")) {
    try {
      const result = await request("GENERATE_README"); $("#readme-content").value = result.content;
      $("#file-state").textContent = "Generated from tracker"; $("#file-state").classList.add("loaded");
      readmeDirty = true; updateEditor(); persistDraft();
      setUploadMessage("Generated from " + state.problems.length + " tracked problem(s). Review, edit, then publish.");
      showToast("Progress README generated.");
      document.querySelectorAll(".step").forEach((step, index) => { step.classList.toggle("done", index === 0); step.classList.toggle("current", index === 1); });
    } catch (error) { showToast(error.message); }
    return;
  }
  if (event.target.closest("#clear-content")) {
    $("#readme-content").value = ""; $("#file-state").textContent = "No file selected"; $("#file-state").classList.remove("loaded");
    updateEditor(); persistDraft(); setUploadMessage("Draft cleared."); return;
  }
  if (event.target.closest("#verify-github")) {
    const button = $("#verify-github"); const message = $("#connect-message");
    button.disabled = true; button.textContent = "Checking access…"; setMessage(message, "Verifying repository and token…");
    try {
      const result = await request("VERIFY_GITHUB", { repo: $("#repo-input").value.trim(), token: $("#token-input").value.trim() });
      state.settings.githubRepo = result.repo; state.settings.githubToken = $("#token-input").value.trim();
      await saveSettings({ githubRepo: result.repo }); $("#token-input").value = "";
      setMessage(message, "Connected to " + result.name + (result.private ? " · private" : " · public") + ".", "success");
      updateConnectionUI(); setUploadMessage("Ready to publish to " + result.repo + "."); showToast("GitHub connection verified.");
    } catch (error) { setMessage(message, error.message, "error"); }
    finally { button.disabled = false; button.innerHTML = "<span class='button-icon'>✓</span> Connect and verify"; }
    return;
  }
  if (event.target.closest("#import-solutions")) {
    const button = $("#import-solutions"); const message = $("#import-message");
    button.disabled = true; button.textContent = "Scanning repository…"; setMessage(message, "Reading solution file names…");
    try {
      const result = await request("IMPORT_GITHUB", { repo: $("#repo-input").value.trim() });
      state = result.state || await request("GET_STATE"); updateConnectionUI();
      setMessage(message, "Found " + result.problems.length + " recognized problem(s); added " + result.added + ".", "success");
      showToast(result.added ? result.added + " solved problems imported." : "Your tracker already includes those problems.");
    } catch (error) { setMessage(message, error.message, "error"); }
    finally { button.disabled = false; button.innerHTML = "Scan repository <span>→</span>"; }
    return;
  }
  if (event.target.closest("#upload-readme")) {
    const button = $("#upload-readme"); if (button.disabled) return;
    const path = $("#readme-path").value.trim() || "README.md";
    button.disabled = true; button.querySelector("span").textContent = "Publishing…";
    setUploadMessage("Uploading " + path + " to " + state.settings.githubRepo + "…");
    try {
      await saveSettings({ readmePath: path });
      const result = await request("UPLOAD_README", { content: $("#readme-content").value, path });
      setUploadMessage("Uploaded " + result.path + " successfully.", "success", result.url);
      document.querySelectorAll(".step").forEach((step) => { step.classList.add("done"); step.classList.remove("current"); });
      showToast("README published to GitHub.");
    } catch (error) { setUploadMessage(error.message, "error"); }
    finally { button.disabled = !state.settings.githubToken || !$("#readme-content").value.trim(); button.querySelector("span").textContent = "Upload README to GitHub"; }
    return;
  }
  if (event.target.closest("#export-data")) {
    const snapshot = await request("GET_STATE");
    downloadJson("leettrack-backup-" + new Date().toISOString().slice(0, 10) + ".json", { format: "leettrack-backup", version: 1, exportedAt: new Date().toISOString(), problems: snapshot.problems, activity: snapshot.activity });
    setMessage($("#data-message"), "Your backup was downloaded.", "success"); return;
  }
  if (event.target.closest("#save-goal")) {
    const goal = Math.max(1, Math.min(50, Math.floor(Number($("#daily-goal").value) || 3)));
    await saveSettings({ dailyGoal: goal }); $("#daily-goal").value = goal;
    setMessage($("#data-message"), "Daily goal saved.", "success"); return;
  }
  if (event.target.closest("#disconnect-github")) {
    await saveSettings({ githubRepo: "", githubToken: "", syncSolutions: false, autoUpdateReadme: false });
    $("#token-input").value = ""; $("#auto-update").checked = false;
    setMessage($("#connect-message"), "GitHub disconnected.", "success"); setUploadMessage("Connect GitHub to enable publishing.");
    showToast("GitHub token removed from this browser."); return;
  }
});
$("#readme-file").addEventListener("change", (event) => importReadmeFile(event.target.files?.[0]));
$("#dropzone").addEventListener("dragover", (event) => { event.preventDefault(); $("#dropzone").classList.add("dragging"); });
$("#dropzone").addEventListener("dragleave", () => $("#dropzone").classList.remove("dragging"));
$("#dropzone").addEventListener("drop", (event) => { event.preventDefault(); $("#dropzone").classList.remove("dragging"); importReadmeFile(event.dataTransfer.files?.[0]); });
$("#dropzone").addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); $("#readme-file").click(); } });
$("#readme-content").addEventListener("input", () => { readmeDirty = true; updateEditor(); persistDraft(); });
$("#readme-path").addEventListener("change", async () => { await saveSettings({ readmePath: $("#readme-path").value.trim() || "README.md" }); });
$("#auto-update").addEventListener("change", async () => {
  if ($("#auto-update").checked && (!state.settings.githubToken || !state.settings.githubRepo)) {
    $("#auto-update").checked = false; showSection("github"); showToast("Connect a GitHub destination before enabling automatic README updates."); return;
  }
  await saveSettings({ autoUpdateReadme: $("#auto-update").checked });
  showToast($("#auto-update").checked ? "Automatic README updates enabled." : "Automatic README updates paused.");
});
$("#sync-solutions").addEventListener("change", async () => {
  if ($("#sync-solutions").checked && (!state.settings.githubToken || !state.settings.githubRepo)) {
    $("#sync-solutions").checked = false; showSection("github"); showToast("Connect a GitHub destination before enabling solution sync."); return;
  }
  await saveSettings({ syncSolutions: $("#sync-solutions").checked });
  showToast($("#sync-solutions").checked ? "Accepted solution sync enabled." : "Accepted solution sync paused.");
});
$("#solution-folder").addEventListener("change", async () => {
  await saveSettings({ solutionFolder: $("#solution-folder").value.trim() || "LeetCode" });
});
$("#backup-file").addEventListener("change", async (event) => {
  const file = event.target.files?.[0]; if (!file) return;
  try {
    const data = JSON.parse(await file.text()); state = await request("IMPORT_DATA", { data }); updateConnectionUI();
    setMessage($("#data-message"), "Backup imported. " + state.problems.length + " problem(s) in your tracker.", "success"); showToast("LeetTrack backup imported.");
  } catch (error) { setMessage($("#data-message"), error.message, "error"); }
  event.target.value = "";
});
chrome.storage.onChanged.addListener((changes) => {
  if (changes.leettrackState) {
    state = changes.leettrackState.newValue; updateConnectionUI();
    if (!readmeDirty) updateEditor();
  }
});
init().catch((error) => showToast(error.message));
