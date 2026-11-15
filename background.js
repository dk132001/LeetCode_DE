const STORAGE_KEY = "leettrackState";
const LEGACY_REFERENCE_REPO = "SanTiwari07/LeetCodeSolved";
const DEFAULT_STATE = {
  settings: {
    githubRepo: "", githubToken: "", readmePath: "README.md", autoUpdateReadme: false,
    syncSolutions: false, solutionFolder: "LeetCode", dailyGoal: 3,
    lastGithubSync: "", lastReadmeSync: ""
  },
  problems: [],
  activity: []
};

chrome.runtime.onInstalled.addListener(async () => {
  const saved = await chrome.storage.local.get(STORAGE_KEY);
  if (!saved[STORAGE_KEY]) await chrome.storage.local.set({ [STORAGE_KEY]: DEFAULT_STATE });
});

async function getState() {
  const saved = await chrome.storage.local.get(STORAGE_KEY);
  const stored = saved[STORAGE_KEY] || {};
  const state = { ...structuredClone(DEFAULT_STATE), ...stored, settings: { ...DEFAULT_STATE.settings, ...(stored.settings || {}) } };
  if (state.settings.githubRepo === LEGACY_REFERENCE_REPO) {
    state.settings.githubRepo = "";
    state.settings.githubToken = "";
    state.settings.syncSolutions = false;
    state.settings.autoUpdateReadme = false;
    await chrome.storage.local.set({ [STORAGE_KEY]: state });
  }
  return state;
}
async function saveState(state) {
  await chrome.storage.local.set({ [STORAGE_KEY]: state });
  return state;
}
function slugify(value) {
  return String(value || "problem").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80) || "problem";
}
function dateKey(date = new Date()) {
  const value = new Date(date);
  return [value.getFullYear(), String(value.getMonth() + 1).padStart(2, "0"), String(value.getDate()).padStart(2, "0")].join("-");
}
function addActivity(state, type, problem, date = new Date()) {
  state.activity.push({ date: dateKey(date), type, slug: problem.slug, title: problem.title });
  state.activity = state.activity.slice(-1200);
}
function mergeProblem(state, input, markSolved = false) {
  const slug = input.slug || slugify(input.title || input.url);
  const index = state.problems.findIndex((item) => item.slug === slug);
  const previous = index >= 0 ? state.problems[index] : {};
  const now = new Date().toISOString();
  const problem = {
    slug,
    title: input.title || previous.title || slug.replace(/-/g, " "),
    url: input.url || previous.url || "https://leetcode.com/problems/" + slug + "/",
    difficulty: (input.difficulty && input.difficulty !== "Unknown") ? input.difficulty : (previous.difficulty || input.difficulty || "Unknown"),
    topics: Array.isArray(input.topics) && input.topics.length ? input.topics : (previous.topics || []),
    status: markSolved ? "Solved" : (input.status || previous.status || "Attempted"),
    completionSource: input.completionSource || (markSolved
      ? (["leetcode-history", "leetcode-accepted"].includes(previous.completionSource) ? previous.completionSource : "manual")
      : (previous.completionSource || "")),
    languages: Array.isArray(input.languages) ? input.languages : (previous.languages || []),
    solutionPaths: Array.isArray(input.solutionPaths) ? input.solutionPaths : (previous.solutionPaths || []),
    note: input.note ?? previous.note ?? "",
    attempts: Math.max(previous.attempts || 0, input.attempts || 0) + (input.incrementAttempt ? 1 : 0),
    createdAt: previous.createdAt || now,
    updatedAt: now,
    solvedAt: input.solvedAt || previous.solvedAt || (markSolved ? now : ""),
    reviewLevel: previous.reviewLevel || 0,
    nextReview: input.nextReview !== undefined ? input.nextReview : (previous.nextReview || (markSolved ? now : ""))
  };
  if (markSolved && !previous.solvedAt) {
    problem.reviewLevel = 0;
    if (input.nextReview === undefined) problem.nextReview = now;
  }
  if (index >= 0) state.problems[index] = problem;
  else state.problems.unshift(problem);
  return { problem, isNew: index < 0, wasSolved: previous.status === "Solved" };
}
function splitRepo(repo) {
  const clean = String(repo || "").trim().replace(/^https?:\/\/(www\.)?github\.com\//i, "").replace(/\.git$/i, "").replace(/\/$/, "");
  const parts = clean.split("/").filter(Boolean);
  if (parts.length !== 2 || !/^[a-zA-Z0-9-]+$/.test(parts[0]) || !/^[a-zA-Z0-9_.-]+$/.test(parts[1])) throw new Error("Enter a GitHub repository as owner/repo.");
  return parts;
}
async function githubRequest(path, token, options = {}) {
  const response = await fetch("https://api.github.com" + path, {
    ...options,
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(token ? { Authorization: "Bearer " + token } : {}),
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {})
    }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || "GitHub returned " + response.status + ".");
  return data;
}
function base64Utf8(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
function buildReadme(state) {
  const includedSources = new Set(["leetcode-accepted", "leetcode-history", "manual"]);
  const solved = state.problems.filter((problem) => problem.status === "Solved" && includedSources.has(problem.completionSource));
  const attempted = state.problems.filter((problem) => problem.status !== "Solved");
  const count = (level) => solved.filter((problem) => String(problem.difficulty).toLowerCase() === level.toLowerCase()).length;
  const knownCount = count("Easy") + count("Medium") + count("Hard");
  const unclassified = Math.max(0, solved.length - knownCount);
  const safeCell = (value) => String(value || "-").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
  const rows = [...solved].sort((a, b) => (a.title || "").localeCompare(b.title || "")).map((problem) => {
    const rawDifficulty = String(problem.difficulty || "Unknown");
    const difficulty = ["easy", "medium", "hard"].includes(rawDifficulty.toLowerCase()) ? rawDifficulty : "Tracked";
    const color = difficulty.toLowerCase() === "easy" ? "2ea44f" : difficulty.toLowerCase() === "medium" ? "d29922" : difficulty.toLowerCase() === "hard" ? "cf222e" : "8957e5";
    const badge = "![" + difficulty + "](https://img.shields.io/badge/" + encodeURIComponent(difficulty) + "-" + color + ")";
    const topics = problem.topics?.length ? problem.topics.map(safeCell).join(", ") : "-";
    const url = problem.url || "https://leetcode.com/problems/" + problem.slug + "/";
    return "| [" + safeCell(problem.title) + "](" + url + ") | " + badge + " | " + topics + " |";
  });
  const solvedRows = rows.length ? rows.join("\n") : "| No accepted solutions tracked yet | - | Start with one problem and build from there. |";
  const languageGroups = new Map();
  for (const problem of solved) {
    for (const solution of problem.solutionPaths || []) {
      if (!solution?.language || !solution?.url) continue;
      if (!languageGroups.has(solution.language)) languageGroups.set(solution.language, []);
      languageGroups.get(solution.language).push({ problem, solution });
    }
  }
  const solutionSections = [...languageGroups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([language, entries]) => {
    const answerRows = entries.sort((a, b) => (a.problem.title || "").localeCompare(b.problem.title || "")).map(({ problem, solution }) => {
      const rawDifficulty = String(problem.difficulty || "Unknown");
      const difficulty = ["easy", "medium", "hard"].includes(rawDifficulty.toLowerCase()) ? rawDifficulty : "Tracked";
      const color = difficulty.toLowerCase() === "easy" ? "2ea44f" : difficulty.toLowerCase() === "medium" ? "d29922" : difficulty.toLowerCase() === "hard" ? "cf222e" : "8957e5";
      const badge = "![" + difficulty + "](https://img.shields.io/badge/" + encodeURIComponent(difficulty) + "-" + color + ")";
      const url = problem.url || "https://leetcode.com/problems/" + problem.slug + "/";
      return "| [" + safeCell(problem.title) + "](" + url + ") | " + badge + " | [View answer](" + solution.url + ") |";
    });
    return "### " + language + "\n\n| Problem | Difficulty | Answer |\n| :--- | :---: | :---: |\n" + answerRows.join("\n");
  });
  const solutionContent = solutionSections.length ? "## Solutions by language\n\n" + solutionSections.join("\n\n") + "\n\n" : "";
  const updated = new Date().toISOString().slice(0, 10);
  const badges = [
    "![Solved](https://img.shields.io/badge/solved-" + solved.length + "-2ea44f?style=for-the-badge&logo=leetcode&logoColor=white)",
    ...(count("Easy") ? ["![Easy](https://img.shields.io/badge/easy-" + count("Easy") + "-2ea44f?style=flat-square)"] : []),
    ...(count("Medium") ? ["![Medium](https://img.shields.io/badge/medium-" + count("Medium") + "-d29922?style=flat-square)"] : []),
    ...(count("Hard") ? ["![Hard](https://img.shields.io/badge/hard-" + count("Hard") + "-cf222e?style=flat-square)"] : []),
    ...(unclassified ? ["![Tracked](https://img.shields.io/badge/tracked-" + unclassified + "-8957e5?style=flat-square)"] : [])
  ].join(" ");
  return "<div align=\"center\">\n\n# LeetCode, one solve at a time\n\n" + badges + "\n\n*An automatically updated list of problems completed in LeetCode.*\n\n</div>\n\n## Progress\n\n| Completed | In progress | Updated |\n| :---: | :---: | :---: |\n| **" + solved.length + "** | **" + attempted.length + "** | " + updated + " |\n\n## Problems completed\n\n| Problem | Difficulty | Topics |\n| :--- | :---: | :--- |\n" + solvedRows + "\n\n" + solutionContent + "---\n\n<sub>Progress generated from the completed problems tracked in LeetTrack.</sub>\n";
}
async function uploadReadme(state, content, path) {
  const [owner, repo] = splitRepo(state.settings.githubRepo);
  const safePath = String(path || state.settings.readmePath || "README.md").trim().replace(/^\/+/, "");
  if (!safePath || safePath.split("/").includes("..")) throw new Error("Enter a valid file path inside the repository.");
  const apiPath = "/repos/" + owner + "/" + repo + "/contents/" + safePath.split("/").map(encodeURIComponent).join("/");
  let sha;
  try { sha = (await githubRequest(apiPath, state.settings.githubToken)).sha; }
  catch (error) { if (!/not found/i.test(error.message)) throw error; }
  return githubRequest(apiPath, state.settings.githubToken, {
    method: "PUT",
    body: JSON.stringify({ message: "Update " + safePath + " with LeetTrack", content: base64Utf8(content), ...(sha ? { sha } : {}) })
  });
}
async function refreshProgressReadme(state, force = false) {
  if (!state.settings.githubToken || !state.settings.githubRepo || (!force && !state.settings.autoUpdateReadme)) return null;
  const path = state.settings.readmePath || "README.md";
  const result = await uploadReadme(state, buildReadme(state), path);
  state.settings.lastReadmeSync = new Date().toISOString();
  state.settings.lastGithubSync = state.settings.lastReadmeSync;
  await saveState(state);
  return { path, url: result.content?.html_url || result.commit?.html_url };
}
function languageExtension(language) {
  const value = String(language || "").toLowerCase();
  const map = { cpp: "cpp", "c++": "cpp", c: "c", python: "py", python3: "py", java: "java", javascript: "js", typescript: "ts", golang: "go", go: "go", rust: "rs", csharp: "cs", "c#": "cs", kotlin: "kt", swift: "swift", ruby: "rb", php: "php", sql: "sql", mysql: "sql", scala: "scala" };
  return map[value] || "txt";
}
function languageFolder(language) {
  const value = String(language || "").toLowerCase();
  const map = { cpp: "C++", "c++": "C++", c: "C", python: "Python", python3: "Python", java: "Java", javascript: "JavaScript", typescript: "TypeScript", golang: "Go", go: "Go", rust: "Rust", csharp: "CSharp", "c#": "CSharp", kotlin: "Kotlin", swift: "Swift", ruby: "Ruby", php: "PHP", sql: "SQL", mysql: "SQL", scala: "Scala" };
  return map[value] || "Other";
}
async function extractEditorCode(tabId) {
  if (!tabId || !chrome.scripting?.executeScript) return null;
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId }, world: "MAIN",
      func: () => {
        const models = window.monaco?.editor?.getModels?.() || [];
        const model = models.find((item) => item.getValue?.().trim());
        if (!model) return null;
        return { code: model.getValue(), language: model.getLanguageId?.() || "text" };
      }
    });
    return result?.result?.code?.trim() ? result.result : null;
  } catch (_) { return null; }
}
async function uploadSolution(state, problem, solution) {
  if (!state.settings.githubToken) throw new Error("Connect GitHub before syncing solutions.");
  const rawFolder = String(state.settings.solutionFolder || "LeetCode").trim().replace(/^\/+|\/+$/g, "");
  const folders = rawFolder.split("/").filter(Boolean);
  if (!folders.length || folders.some((part) => part === "." || part === ".." || !/^[a-zA-Z0-9._ -]+$/.test(part))) throw new Error("Choose a valid solution folder path.");
  const [owner, repo] = splitRepo(state.settings.githubRepo);
  const slug = slugify(problem.slug || problem.title);
  const language = languageFolder(solution.language);
  const fileName = "solution." + languageExtension(solution.language);
  const problemPath = folders.concat(language, slug);
  const path = problemPath.concat(fileName).map(encodeURIComponent).join("/");
  const apiPath = "/repos/" + owner + "/" + repo + "/contents/" + path;
  let sha;
  try { sha = (await githubRequest(apiPath, state.settings.githubToken)).sha; }
  catch (error) { if (!/not found/i.test(error.message)) throw error; }
  const result = await githubRequest(apiPath, state.settings.githubToken, {
    method: "PUT",
    body: JSON.stringify({ message: "Add " + language + " solution: " + problem.title, content: base64Utf8(solution.code), ...(sha ? { sha } : {}) })
  });
  const problemReadme = [
    "# " + (problem.title || slug), "",
    "- **Language:** " + language,
    "- **Difficulty:** " + (problem.difficulty || "Unknown"),
    "- **Accepted:** " + (problem.solvedAt ? new Date(problem.solvedAt).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10)),
    "- **Question:** [Open on LeetCode](" + (problem.url || "https://leetcode.com/problems/" + slug + "/") + ")",
    "- **Answer:** [solution." + languageExtension(solution.language) + "](" + fileName + ")", ""
  ].join("\n");
  const cardPath = problemPath.concat("README.md").map(encodeURIComponent).join("/");
  const cardResult = await uploadReadme(state, problemReadme, cardPath);
  return { path, url: result.content?.html_url || result.commit?.html_url, cardPath, cardUrl: cardResult.content?.html_url || cardResult.commit?.html_url, language };
}
function rememberSolution(problem, uploaded) {
  const paths = Array.isArray(problem.solutionPaths) ? problem.solutionPaths : [];
  problem.solutionPaths = paths.filter((item) => item.language !== uploaded.language);
  problem.solutionPaths.push(uploaded);
  problem.languages = [...new Set([...(problem.languages || []), uploaded.language])];
}
async function importRepoProblems(repoInput, token) {
  const [owner, repo] = splitRepo(repoInput);
  const info = await githubRequest("/repos/" + owner + "/" + repo, token);
  const tree = await githubRequest("/repos/" + owner + "/" + repo + "/git/trees/" + encodeURIComponent(info.default_branch) + "?recursive=1", token);
  if (tree.truncated) throw new Error("This repository is too large to scan in one pass.");
  const seen = new Map();
  for (const entry of tree.tree || []) {
    if (entry.type !== "blob" || /(^|\/)(readme|license|changelog)(\.|$)/i.test(entry.path) || entry.path.split("/").some((part) => part.startsWith("."))) continue;
    const segments = entry.path.split("/");
    const file = segments[segments.length - 1];
    if (!/\.(cpp|cc|c|h|hpp|py|java|js|jsx|ts|tsx|go|rs|sql|cs|kt|swift|rb|php|scala)$/i.test(file)) continue;
    const fileBase = file.replace(/\.[^.]+$/, "");
    const folder = segments.length > 1 ? segments[segments.length - 2] : "";
    const genericFile = /^(solution|answer|main|index|code)$/i.test(fileBase);
    const genericFolder = /^(solutions?|leetcode|array|arrays|strings?|trees?|graphs?|linked[-_ ]?lists?|dynamic[-_ ]?programming|easy|medium|hard|topics?)$/i.test(folder);
    let candidate = "";
    if (/^\d{1,5}[.\s_-]+/.test(fileBase) || /[.\s_-]+\d{1,5}$/.test(fileBase)) candidate = fileBase;
    else if (folder && (/^\d{1,5}[.\s_-]+/.test(folder) || /[.\s_-]+\d{1,5}$/.test(folder))) candidate = folder;
    else if (genericFile && folder && !genericFolder) candidate = folder;
    else if (folder && !genericFile && !genericFolder) candidate = fileBase;
    else if (folder && !genericFile && /[-\s]/.test(fileBase)) candidate = fileBase;
    if (!candidate) continue;
    const raw = candidate.replace(/^\d{1,5}[.\s_-]+/, "").replace(/[.\s_-]+\d{1,5}$/, "");
    const title = raw.replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
    if (title.length < 2 || title.length > 100 || /^(solution|main|index|code)$/i.test(title)) continue;
    const slug = slugify(title);
    if (!seen.has(slug)) seen.set(slug, { slug, title: title.replace(/\b\w/g, (c) => c.toUpperCase()), status: "Solved", completionSource: "repository", difficulty: "Unknown", topics: [], url: "https://leetcode.com/problems/" + slug + "/" });
  }
  return { repo: owner + "/" + repo, problems: [...seen.values()] };
}
async function handleMessage(message, sender) {
  const state = await getState();
  switch (message.type) {
    case "GET_STATE": return state;
    case "UPSERT_PROBLEM": {
      const result = mergeProblem(state, message.problem || {}, Boolean(message.markSolved));
      if (message.markSolved && !result.wasSolved) addActivity(state, "solved", result.problem);
      else if (message.problem?.incrementAttempt) addActivity(state, "attempt", result.problem);
      await saveState(state);
      if (state.settings.autoUpdateReadme && state.settings.githubToken) {
        try { await refreshProgressReadme(state); }
        catch (error) { return { state, warning: "Saved locally. README sync failed: " + error.message }; }
      }
      return { state };
    }
    case "ACCEPTED_SUBMISSION": {
      const result = mergeProblem(state, { ...(message.problem || {}), completionSource: "leetcode-accepted", incrementAttempt: true }, true);
      if (!result.wasSolved) addActivity(state, "solved", result.problem);
      await saveState(state);
      const response = { state };
      if ((state.settings.syncSolutions || message.forceSolutionSync) && state.settings.githubToken) {
        const solution = await extractEditorCode(sender?.tab?.id);
        if (solution) {
          try {
            response.solution = await uploadSolution(state, result.problem, solution);
            rememberSolution(result.problem, response.solution);
            state.settings.lastGithubSync = new Date().toISOString();
            await saveState(state);
          }
          catch (error) { response.warning = "Saved locally; GitHub solution sync failed: " + error.message; }
        } else response.warning = "Saved locally; the LeetCode editor code was not available to sync.";
      }
      if (state.settings.autoUpdateReadme && state.settings.githubToken) {
        try { response.readme = await refreshProgressReadme(state); }
        catch (error) { response.warning = (response.warning ? response.warning + " " : "") + "README sync failed: " + error.message; }
      }
      return response;
    }
    case "DELETE_PROBLEM": {
      state.problems = state.problems.filter((problem) => problem.slug !== message.slug);
      await saveState(state);
      try { await refreshProgressReadme(state); }
      catch (error) { state.syncWarning = "Deleted locally. README sync failed: " + error.message; }
      return state;
    }
    case "LEETCODE_COMPLETED_SYNC": {
      if (!state.settings.githubToken || !state.settings.githubRepo) throw new Error("Connect GitHub in the extension popup before syncing completed problems.");
      if (!Array.isArray(message.problems)) throw new Error("LeetCode did not return a valid accepted-problem list.");
      const accepted = new Map();
      for (const item of message.problems) {
        if (!item?.slug) continue;
        const slug = slugify(item.slug);
        accepted.set(slug, { ...item, slug, status: "Solved", completionSource: "leetcode-history" });
      }
      for (const problem of state.problems) {
        if (["leetcode-history", "leetcode-accepted"].includes(problem.completionSource) && !accepted.has(problem.slug)) {
          problem.status = "Attempted";
          problem.completionSource = "";
          problem.solvedAt = "";
          problem.nextReview = "";
        }
      }
      for (const item of accepted.values()) {
        const result = mergeProblem(state, item, true);
        if (!result.wasSolved) addActivity(state, "solved", result.problem, item.solvedAt || new Date());
      }
      state.settings.lastLeetCodeHistorySync = new Date().toISOString();
      state.settings.lastLeetCodeHistoryCount = accepted.size;
      await saveState(state);
      const readme = await refreshProgressReadme(state, true);
      return { username: String(message.username || ""), count: accepted.size, readme };
    }
    case "LEETCODE_SOLUTION_BATCH": {
      if (!state.settings.githubToken || !state.settings.githubRepo) throw new Error("Connect GitHub in the extension popup before syncing solutions.");
      if (!Array.isArray(message.solutions)) throw new Error("LeetCode did not return a valid solution batch.");
      let uploaded = 0;
      let failed = 0;
      let warning = "";
      for (const solution of message.solutions) {
        if (!solution?.slug || !solution.language || !String(solution.code || "").trim()) { failed++; continue; }
        const problem = state.problems.find((item) => item.slug === slugify(solution.slug) && item.status === "Solved");
        if (!problem) { failed++; continue; }
        try {
          const result = await uploadSolution(state, problem, solution);
          rememberSolution(problem, result);
          uploaded++;
        } catch (error) {
          failed++;
          warning = warning || error.message || "A solution could not be uploaded.";
        }
      }
      if (uploaded) state.settings.lastGithubSync = new Date().toISOString();
      await saveState(state);
      let readme = null;
      if (message.final) {
        try { readme = await refreshProgressReadme(state, true); }
        catch (error) { warning = warning || "Solution files uploaded, but README refresh failed: " + error.message; }
      }
      return { uploaded, failed, warning, readme };
    }
    case "REVIEWED": {
      const problem = state.problems.find((item) => item.slug === message.slug);
      if (!problem) throw new Error("Problem not found.");
      problem.reviewLevel = Math.min((problem.reviewLevel || 0) + 1, 5);
      const delays = [1, 3, 7, 14, 30, 60];
      const next = new Date();
      next.setDate(next.getDate() + delays[Math.max(0, problem.reviewLevel - 1)]);
      problem.nextReview = next.toISOString();
      problem.updatedAt = new Date().toISOString();
      addActivity(state, "review", problem);
      await saveState(state);
      return state;
    }
    case "SAVE_SETTINGS":
      state.settings = { ...state.settings, ...message.settings };
      await saveState(state);
      return state;
    case "VERIFY_GITHUB": {
      const [owner, repo] = splitRepo(message.repo);
      const token = String(message.token || "").trim();
      if (!token) throw new Error("Add a GitHub token with Contents read and write access.");
      const info = await githubRequest("/repos/" + owner + "/" + repo, token);
      if (info.permissions && info.permissions.push === false) throw new Error("This token can read the repository but does not have write access.");
      await saveState({ ...state, settings: { ...state.settings, githubRepo: owner + "/" + repo, githubToken: token, syncSolutions: true, autoUpdateReadme: true } });
      return { repo: owner + "/" + repo, name: info.full_name, private: info.private, defaultBranch: info.default_branch };
    }
    case "IMPORT_GITHUB": {
      const data = await importRepoProblems(message.repo, state.settings.githubToken);
      const existing = new Set(state.problems.map((problem) => problem.slug));
      let added = 0;
      for (const problem of data.problems) {
        if (existing.has(problem.slug)) continue;
        mergeProblem(state, problem, true);
        added++;
      }
      state.settings.githubRepo = data.repo;
      if (added) state.activity.push({ date: dateKey(), type: "import", title: "Imported " + added + " solved problems" });
      await saveState(state);
      try { await refreshProgressReadme(state); }
      catch (error) { return { ...data, added, state, warning: 'Imported locally. README sync failed: ' + error.message }; }
      return { ...data, added, state };
    }
    case "UPLOAD_README": {
      if (!state.settings.githubToken) throw new Error("Connect GitHub first.");
      const result = await uploadReadme(state, String(message.content || ""), message.path);
      state.settings.lastReadmeSync = new Date().toISOString();
      state.settings.lastGithubSync = state.settings.lastReadmeSync;
      await saveState(state);
      return { url: result.content?.html_url || result.commit?.html_url, path: message.path || state.settings.readmePath };
    }
    case "GENERATE_README": return { content: buildReadme(state) };
    case "IMPORT_DATA": {
      const data = message.data;
      if (!data || !Array.isArray(data.problems)) throw new Error("This file is not a LeetTrack backup.");
      const bySlug = new Map(state.problems.map((problem) => [problem.slug, problem]));
      for (const item of data.problems) if (item?.slug) bySlug.set(item.slug, item);
      state.problems = [...bySlug.values()];
      if (Array.isArray(data.activity)) state.activity = [...state.activity, ...data.activity].slice(-1200);
      await saveState(state);
      try { await refreshProgressReadme(state); }
      catch (error) { state.syncWarning = "Backup imported locally. README sync failed: " + error.message; }
      return state;
    }
    default: throw new Error("Unknown request.");
  }
}
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender).then((result) => sendResponse({ ok: true, result }))
    .catch((error) => sendResponse({ ok: false, error: error.message || "Something went wrong." }));
  return true;
});
