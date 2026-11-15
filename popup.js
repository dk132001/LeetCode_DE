const $ = (selector) => document.querySelector(selector);
let state = null;
let editingConnection = false;
let activeTab = null;
let acceptedOnPage = false;
let busy = false;
let toastTimer = 0;

async function request(type, payload = {}) {
  const response = await chrome.runtime.sendMessage({ type, ...payload });
  if (!response?.ok) throw new Error(response?.error || "The request could not be completed.");
  return response.result;
}
function toast(message, error = false) {
  const node = $("#toast");
  node.textContent = message;
  node.classList.toggle("error", error);
  node.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.classList.remove("show"), 3600);
}
function setStatus(message, error = false) {
  const node = $("#sync-status");
  node.textContent = message;
  node.parentElement.classList.toggle("has-error", error);
}
function connected() {
  return Boolean(state?.settings?.githubRepo && state?.settings?.githubToken);
}
function formatTime(value) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : "Last sync " + date.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}
function render() {
  const hasConnection = connected();
  $("#connect-panel").classList.toggle("hidden", hasConnection && !editingConnection);
  $("#connected-panel").classList.toggle("hidden", !hasConnection || editingConnection);
  if (document.activeElement !== $("#repo-input")) $("#repo-input").value = state?.settings?.githubRepo || "";
  $("#tracked-count").textContent = (state?.problems?.length || 0) + " tracked problem" + ((state?.problems?.length || 0) === 1 ? "" : "s");
  const repo = state?.settings?.githubRepo || "";
  $("#repo-link").href = repo ? "https://github.com/" + repo : "#";
  $("#repo-link").textContent = repo || "No repository connected";
  $("#auto-sync").checked = Boolean(state?.settings?.syncSolutions);
  $("#auto-readme").checked = Boolean(state?.settings?.autoUpdateReadme);
  $("#last-sync").textContent = formatTime(state?.settings?.lastGithubSync || state?.settings?.lastReadmeSync);
  $("#sync-current").disabled = busy || !hasConnection || !activeTab || !acceptedOnPage;
  $("#update-readme").disabled = busy || !hasConnection;
  $("#connect-button").disabled = busy;
  $("#footer-readme").textContent = state?.settings?.autoUpdateReadme ? "ON" : "OFF";
  if (!hasConnection) setStatus("Connect a repository to start syncing.");
  else if (!acceptedOnPage) setStatus("Ready. Open an accepted LeetCode result to sync it.");
}
async function refreshActiveTab() {
  acceptedOnPage = false;
  activeTab = null;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !/^https:\/\/(www\.)?leetcode\.com\//i.test(tab.url || "")) return;
    activeTab = tab;
    let response;
    try { response = await chrome.tabs.sendMessage(tab.id, { type: "GET_SYNC_CONTEXT" }); }
    catch (_) {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
      response = await chrome.tabs.sendMessage(tab.id, { type: "GET_SYNC_CONTEXT" });
    }
    acceptedOnPage = Boolean(response?.accepted && response?.context);
  } catch (_) { activeTab = null; acceptedOnPage = false; }
  render();
}
async function initializeReadme() {
  const generated = await request("GENERATE_README");
  return request("UPLOAD_README", { content: generated.content, path: state?.settings?.readmePath || "README.md" });
}
async function connectGitHub() {
  const repo = $("#repo-input").value.trim();
  const token = $("#token-input").value.trim();
  if (!repo || !token) { toast("Add your repository and GitHub token first.", true); return; }
  busy = true;
  const button = $("#connect-button");
  button.querySelector("span").textContent = "Connecting…";
  render();
  try {
    const result = await request("VERIFY_GITHUB", { repo, token });
    state = await request("GET_STATE");
    editingConnection = false;
    $("#token-input").value = "";
    render();
    setStatus("Connected. Creating your colorful README…");
    try {
      const uploaded = await initializeReadme();
      state = await request("GET_STATE");
      setStatus("Connected to " + result.repo + ". README initialized.");
      toast("GitHub connected and README updated.");
      if (uploaded?.url) $("#repo-link").title = "Open repository";
    } catch (error) {
      setStatus("Connected, but README could not update: " + error.message, true);
      toast("GitHub connected; README update failed.", true);
    }
  } catch (error) {
    setStatus(error.message, true);
    toast(error.message, true);
  } finally {
    busy = false;
    button.querySelector("span").textContent = "Connect & initialize README";
    render();
  }
}
async function syncCurrent() {
  if (!activeTab?.id) return;
  busy = true;
  render();
  setStatus("Syncing accepted solution and README…");
  try {
    const result = await chrome.tabs.sendMessage(activeTab.id, { type: "SYNC_CURRENT_SOLUTION" });
    if (!result?.ok) throw new Error(result?.error || "Could not sync this accepted result.");
    if (result.warning) throw new Error(result.warning);
    state = await request("GET_STATE");
    const path = result.solution?.path ? "Solution and README synced (" + result.solution.path + ")." : result.readme ? "README updated on GitHub." : "Accepted result synced.";
    setStatus(path);
    toast(path);
  } catch (error) {
    setStatus(error.message, true);
    toast(error.message, true);
  } finally { busy = false; render(); }
}
async function updateReadme() {
  busy = true;
  render();
  setStatus("Updating README.md…");
  try {
    const uploaded = await initializeReadme();
    state = await request("GET_STATE");
    setStatus("README updated on GitHub.");
    toast("README updated.");
    if (uploaded?.url) $("#repo-link").title = "Open repository";
  } catch (error) {
    setStatus(error.message, true);
    toast(error.message, true);
  } finally { busy = false; render(); }
}
async function saveSetting(key, value) {
  try {
    state = await request("SAVE_SETTINGS", { settings: { [key]: value } });
    setStatus(key === "syncSolutions" ? (value ? "Accepted solutions will sync automatically." : "Automatic solution sync paused.") : (value ? "README will refresh after each accepted solve." : "Automatic README updates paused."));
    render();
  } catch (error) { toast(error.message, true); }
}
async function disconnect() {
  state = await request("SAVE_SETTINGS", { settings: { githubRepo: "", githubToken: "", syncSolutions: false, autoUpdateReadme: false } });
  editingConnection = false;
  acceptedOnPage = false;
  $("#token-input").value = "";
  toast("GitHub disconnected.");
  render();
}

$("#connect-button").addEventListener("click", connectGitHub);
$("#show-token").addEventListener("click", () => {
  const input = $("#token-input");
  input.type = input.type === "password" ? "text" : "password";
  $("#show-token").textContent = input.type === "password" ? "Show" : "Hide";
});
$("#settings-button").addEventListener("click", () => chrome.runtime.openOptionsPage());
$("#edit-connection").addEventListener("click", () => { editingConnection = true; render(); $("#repo-input").focus(); });
$("#auto-sync").addEventListener("change", (event) => saveSetting("syncSolutions", event.target.checked));
$("#auto-readme").addEventListener("change", (event) => saveSetting("autoUpdateReadme", event.target.checked));
$("#sync-current").addEventListener("click", syncCurrent);
$("#update-readme").addEventListener("click", updateReadme);
$("#disconnect-button").addEventListener("click", disconnect);
chrome.storage.onChanged.addListener((changes) => {
  if (changes.leettrackState) {
    state = changes.leettrackState.newValue;
    render();
  }
});

(async () => {
  try {
    state = await request("GET_STATE");
    await refreshActiveTab();
    render();
  } catch (error) { setStatus(error.message, true); }
})();
