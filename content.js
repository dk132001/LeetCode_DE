(() => {
  if (window.__leetTrackContentLoaded) return;
  window.__leetTrackContentLoaded = true;
  let lastUrl = "";
  let lastResultText = "";
  let context = null;
  let syncPromptHost = null;
  let syncPromptShownForTab = false;

  function readContext() {
    const slug = location.pathname.match(/\/problems\/([^/]+)/)?.[1];
    if (!slug) return null;
    const heading = document.querySelector("[data-cy='question-title'], [data-e2e-locator='question-title'], h1");
    const title = heading?.textContent?.trim().replace(/^\d+\.\s*/, "") || slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    const bodyText = document.body?.innerText || "";
    const difficulty = ["Easy", "Medium", "Hard"].find((level) => new RegExp("\\b" + level + "\\b", "i").test(bodyText.slice(0, 2200))) || "Unknown";
    const topics = [...document.querySelectorAll("a[href*='/tag/'], a[href*='/topics/']")]
      .map((node) => node.textContent.trim()).filter(Boolean).slice(0, 8);
    return { slug, title, url: "https://leetcode.com/problems/" + slug + "/", difficulty, topics };
  }

  function resultText() {
    return document.querySelector("[data-e2e-locator='submission-result'], [data-cy='submission-result'], [data-e2e-locator='submission-result-popup']")?.textContent?.trim() || "";
  }

  function inspect() {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      context = null;
      lastResultText = resultText();
      if (!syncPromptShownForTab) showHistorySyncPrompt();
    }
    const freshContext = readContext();
    if (freshContext) context = freshContext;
    if (!context) return;
    const text = resultText();
    if (/accepted/i.test(text) && !/accepted/i.test(lastResultText)) {
      chrome.runtime.sendMessage({ type: "ACCEPTED_SUBMISSION", problem: context }).then((response) => {
        const result = response?.result;
        if (result?.warning) showSyncNotice(result.warning, true);
        else if (result?.solution) showSyncNotice("Solution saved to GitHub: " + result.solution.path, false);
        else if (result?.readme) showSyncNotice("Progress README updated on GitHub: " + result.readme.path, false);
      }).catch(() => {});
    }
    lastResultText = text;
  }

  function showSyncNotice(message, isError) {
    let notice = document.getElementById("leettrack-sync-notice");
    if (!notice) {
      notice = document.createElement("div");
      notice.id = "leettrack-sync-notice";
      Object.assign(notice.style, {
        position: "fixed", zIndex: "2147483647", right: "20px", bottom: "20px", maxWidth: "360px",
        padding: "11px 14px", borderRadius: "10px", color: "#fff", font: "12px/1.45 system-ui, sans-serif",
        boxShadow: "0 10px 30px rgba(25, 15, 45, .25)", transition: "opacity .2s ease"
      });
      document.documentElement.append(notice);
    }
    notice.style.background = isError ? "#9b4d50" : "#302748";
    notice.textContent = message;
    notice.style.opacity = "1";
    clearTimeout(notice._hideTimer);
    notice._hideTimer = setTimeout(() => { notice.style.opacity = "0"; }, 5500);
  }

  async function getLeetCodeAccount() {
    const response = await fetch(location.origin + "/graphql/", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        operationName: "globalData",
        variables: {},
        query: "query globalData { userStatus { isSignedIn username userSlug } }"
      })
    });
    if (!response.ok) throw new Error("LeetCode account check failed (HTTP " + response.status + ").");
    const payload = await response.json().catch(() => null);
    const user = payload?.data?.userStatus;
    if (!user?.isSignedIn || !user.username) throw new Error("Sign in to LeetCode in this tab, then select Sync again.");
    return user.username;
  }

  async function fetchAcceptedHistory(onProgress) {
    const username = await getLeetCodeAccount();
    const accepted = new Map();
    const pageSize = 500;
    const maxPages = 30;
    let scanned = 0;
    let total = 0;
    let complete = false;
    const query = "query userProgressQuestionList($filters: UserProgressQuestionListInput) { userProgressQuestionList(filters: $filters) { totalNum questions { title titleSlug difficulty lastSubmittedAt topicTags { name } } } }";
    for (let page = 0; page < maxPages; page++) {
      const skip = page * pageSize;
      const response = await fetch(location.origin + "/graphql/", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          operationName: "userProgressQuestionList",
          variables: { filters: { questionStatus: "SOLVED", skip, limit: pageSize } },
          query
        })
      });
      if (!response.ok) throw new Error("LeetCode progress sync failed (HTTP " + response.status + ").");
      const payload = await response.json().catch(() => null);
      if (payload?.errors?.length) throw new Error(payload.errors[0].message || "LeetCode rejected the progress query.");
      const data = payload?.data?.userProgressQuestionList;
      if (!data || !Array.isArray(data.questions)) throw new Error("LeetCode returned an unexpected progress response.");
      total = Number(data.totalNum) || 0;
      scanned += data.questions.length;
      for (const question of data.questions) {
        const slug = question.titleSlug || question.title_slug;
        if (!slug) continue;
        const lastSubmittedAt = question.lastSubmittedAt || question.last_submitted_at || "";
        const solvedDate = lastSubmittedAt ? new Date(lastSubmittedAt) : null;
        accepted.set(slug, {
          slug,
          title: question.title || slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
          url: "https://leetcode.com/problems/" + slug + "/",
          status: "Solved",
          difficulty: question.difficulty || "Unknown",
          topics: (question.topicTags || []).map((tag) => tag.name).filter(Boolean),
          solvedAt: solvedDate && !Number.isNaN(solvedDate.getTime()) ? solvedDate.toISOString() : new Date().toISOString(),
          nextReview: ""
        });
      }
      onProgress(scanned, accepted.size);
      if (scanned >= total || data.questions.length < pageSize) { complete = true; break; }
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    if (!complete) throw new Error("LeetCode returned more solved problems than this sync can safely process. No changes were sent.");
    return { username, scanned, problems: [...accepted.values()] };
  }

  async function leetCodeGraphql(operationName, query, variables = {}) {
    const response = await fetch(location.origin + "/graphql/", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ operationName, variables, query })
    });
    if (!response.ok) throw new Error("LeetCode request failed (HTTP " + response.status + ").");
    const payload = await response.json().catch(() => null);
    if (payload?.errors?.length) throw new Error(payload.errors[0].message || "LeetCode rejected the request.");
    return payload?.data || null;
  }

  async function fetchAcceptedSolutions(problems, onProgress) {
    const listQuery = "query submissionList($offset: Int!, $limit: Int!, $questionSlug: String!) { submissionList(offset: $offset, limit: $limit, questionSlug: $questionSlug) { hasNext submissions { id statusDisplay lang timestamp } } }";
    const detailsQuery = "query submissionDetails($submissionId: Int!) { submissionDetails(submissionId: $submissionId) { code lang question { title titleSlug } } }";
    const uniqueProblems = [...new Map(problems.map((problem) => [problem.slug, problem])).values()];
    if (!uniqueProblems.length) return { solutions: [], unavailable: 0 };
    const solutions = [];
    let unavailable = 0;
    let cursor = 0;
    let completed = 0;

    async function readProblem(problem, suppliedData) {
      const data = suppliedData || await leetCodeGraphql("submissionList", listQuery, { offset: 0, limit: 20, questionSlug: problem.slug });
      const submissionList = data?.submissionList;
      if (!submissionList || !Array.isArray(submissionList.submissions)) throw new Error("LeetCode returned an unexpected submissions response.");
      const acceptedByLanguage = new Map();
      for (const submission of submissionList.submissions) {
        if (String(submission.statusDisplay || "").toLowerCase() !== "accepted" || !submission.lang || !submission.id) continue;
        const languageKey = String(submission.lang).toLowerCase();
        if (!acceptedByLanguage.has(languageKey)) acceptedByLanguage.set(languageKey, submission);
      }
      for (const submission of acceptedByLanguage.values()) {
        try {
          const detailData = await leetCodeGraphql("submissionDetails", detailsQuery, { submissionId: Number(submission.id) });
          const detail = detailData?.submissionDetails;
          if (!detail?.code || !detail.lang) { unavailable++; continue; }
          solutions.push({
            slug: problem.slug,
            title: detail.question?.title || problem.title,
            url: problem.url,
            difficulty: problem.difficulty,
            topics: problem.topics,
            solvedAt: problem.solvedAt,
            language: detail.lang || submission.lang,
            code: detail.code
          });
        } catch (_) { unavailable++; }
      }
    }

    const firstData = await leetCodeGraphql("submissionList", listQuery, { offset: 0, limit: 20, questionSlug: uniqueProblems[0].slug });
    if (!firstData?.submissionList || !Array.isArray(firstData.submissionList.submissions)) throw new Error("LeetCode returned an unexpected submissions response.");
    async function worker() {
      while (true) {
        const index = cursor++;
        if (index >= uniqueProblems.length) return;
        try { await readProblem(uniqueProblems[index], index === 0 ? firstData : null); }
        catch (_) { unavailable++; }
        completed++;
        onProgress(completed, uniqueProblems.length, solutions.length, unavailable);
        await new Promise((resolve) => setTimeout(resolve, 90));
      }
    }
    await Promise.all(Array.from({ length: Math.min(3, uniqueProblems.length) }, worker));
    return { solutions, unavailable };
  }

  function showHistorySyncPrompt() {
    if (syncPromptHost || syncPromptShownForTab || /\/accounts\/login/.test(location.pathname)) return;
    syncPromptShownForTab = true;
    syncPromptHost = document.createElement("div");
    syncPromptHost.id = "leettrack-history-sync-prompt";
    Object.assign(syncPromptHost.style, { position: "fixed", zIndex: "2147483646", right: "18px", top: "18px" });
    const shadow = syncPromptHost.attachShadow({ mode: "open" });
    shadow.innerHTML = `
      <style>
        *{box-sizing:border-box} .card{width:320px;padding:18px;border:1px solid #e8e6eb;border-radius:16px;background:#fff;color:#25232a;box-shadow:0 16px 48px #1c12352a;font:13px/1.45 Inter,system-ui,-apple-system,Segoe UI,sans-serif}
        .top{display:flex;align-items:center;gap:10px}.mark{width:34px;height:34px;display:grid;place-items:center;border-radius:10px;background:#6d4ae8;color:#fff;font-weight:800}.title{font-size:15px;font-weight:760}.sub{margin-top:2px;color:#84808b;font-size:11px}
        p{margin:14px 0;color:#5d5964;font-size:12px}.actions{display:flex;gap:8px}.button{height:36px;padding:0 12px;border:0;border-radius:9px;font:700 11px/1 system-ui,sans-serif;cursor:pointer}.primary{flex:1;color:#fff;background:#6d4ae8}.secondary{color:#5d5964;background:#f2f1f4}.status{min-height:16px;margin-top:10px;color:#76717e;font-size:10px}.close{float:right;border:0;background:transparent;color:#aaa;font-size:17px;cursor:pointer}
      </style>
      <section class="card" role="dialog" aria-label="Sync completed LeetCode problems">
        <button class="close" aria-label="Dismiss">×</button>
        <div class="top"><span class="mark">LT</span><div><div class="title">Sync completed problems?</div><div class="sub">LeetTrack · GitHub progress</div></div></div>
        <p>Sync completed problems and accepted answers to your GitHub README and language folders.</p>
        <div class="actions"><button class="button primary" id="sync">Sync completed problems</button><button class="button secondary" id="later">Not now</button></div>
        <div class="status" aria-live="polite"></div>
      </section>`;
    document.documentElement.append(syncPromptHost);
    const status = shadow.querySelector(".status");
    const syncButton = shadow.querySelector("#sync");
    const dismiss = () => { syncPromptHost?.remove(); syncPromptHost = null; };
    shadow.querySelector(".close").addEventListener("click", dismiss);
    shadow.querySelector("#later").addEventListener("click", dismiss);
    syncButton.addEventListener("click", async () => {
      syncButton.disabled = true;
      shadow.querySelector("#later").disabled = true;
      status.textContent = "Checking your LeetCode account...";
      try {
        const stateResponse = await chrome.runtime.sendMessage({ type: "GET_STATE" });
        const state = stateResponse?.result;
        if (!stateResponse?.ok || !state?.settings?.githubRepo || !state?.settings?.githubToken) {
          throw new Error("Connect GitHub in the extension popup first.");
        }
        status.textContent = "Reading your completed problem list...";
        const history = await fetchAcceptedHistory((scanned, accepted) => {
          status.textContent = scanned.toLocaleString() + " problems loaded; " + accepted.toLocaleString() + " accepted problems found.";
        });
        status.textContent = "Updating your GitHub README...";
        const response = await chrome.runtime.sendMessage({
          type: "LEETCODE_COMPLETED_SYNC",
          username: history.username,
          scanned: history.scanned,
          problems: history.problems
        });
        if (!response?.ok) throw new Error(response?.error || "GitHub sync failed.");
        const result = response.result || {};
        let uploadedSolutions = 0;
        let failedSolutions = 0;
        let solutionWarning = "";
        if (history.problems.length) {
          try {
            status.textContent = "Finding accepted answers for your completed problems...";
            const found = await fetchAcceptedSolutions(history.problems, (done, total, foundCount, unavailable) => {
              status.textContent = "Checking accepted answers: " + done.toLocaleString() + "/" + total.toLocaleString() + " problems; " + foundCount.toLocaleString() + " answers found.";
            });
            failedSolutions += found.unavailable;
            const batchSize = 4;
            for (let index = 0; index < found.solutions.length; index += batchSize) {
              const batch = found.solutions.slice(index, index + batchSize);
              const final = index + batchSize >= found.solutions.length;
              status.textContent = "Saving accepted answers to GitHub: " + Math.min(index + batch.length, found.solutions.length).toLocaleString() + "/" + found.solutions.length.toLocaleString() + "...";
              const batchResponse = await chrome.runtime.sendMessage({ type: "LEETCODE_SOLUTION_BATCH", solutions: batch, final });
              if (!batchResponse?.ok) throw new Error(batchResponse?.error || "GitHub solution upload failed.");
              const batchResult = batchResponse.result || {};
              uploadedSolutions += batchResult.uploaded || 0;
              failedSolutions += batchResult.failed || 0;
              solutionWarning = solutionWarning || batchResult.warning || "";
            }
            if (!found.solutions.length && !found.unavailable) solutionWarning = "LeetCode did not return accepted source code for these completed problems.";
          } catch (error) {
            solutionWarning = error.message || "LeetCode accepted answers could not be synced.";
          }
        }
        status.textContent = "Synced " + (result.count || 0).toLocaleString() + " completed problems and " + uploadedSolutions.toLocaleString() + " answers to GitHub.";
        syncButton.textContent = "Synced";
        let notice = "GitHub README updated with " + (result.count || 0).toLocaleString() + " completed problems; " + uploadedSolutions.toLocaleString() + " accepted answers saved by language.";
        if (failedSolutions) notice += " " + failedSolutions.toLocaleString() + " answers were unavailable or failed to upload.";
        if (solutionWarning) notice += " " + solutionWarning;
        showSyncNotice(notice, Boolean(solutionWarning || failedSolutions));
      } catch (error) {
        status.textContent = error.message || "Sync failed.";
        status.style.color = "#b54740";
        syncButton.disabled = false;
        shadow.querySelector("#later").disabled = false;
      }
    });
  }

  async function syncCurrentSolution() {
    const current = readContext();
    if (!current) return { ok: false, error: "Open a LeetCode problem first." };
    if (!/accepted/i.test(resultText())) return { ok: false, error: "This problem does not show an Accepted result yet." };
    const response = await chrome.runtime.sendMessage({ type: "ACCEPTED_SUBMISSION", problem: current, forceSolutionSync: true });
    if (!response?.ok) return { ok: false, error: response?.error || "GitHub sync failed." };
    return { ok: true, ...(response.result || {}) };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === "GET_CONTEXT") { sendResponse({ context: readContext() }); return; }
    if (message.type === "GET_SYNC_CONTEXT") { sendResponse({ context: readContext(), accepted: /accepted/i.test(resultText()) }); return; }
    if (message.type === "SYNC_CURRENT_SOLUTION") {
      syncCurrentSolution().then(sendResponse).catch((error) => sendResponse({ ok: false, error: error.message || "GitHub sync failed." }));
      return true;
    }
  });

  const observer = new MutationObserver(inspect);
  observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  window.addEventListener("popstate", inspect);
  setInterval(inspect, 1200);
  inspect();
  showHistorySyncPrompt();
})();
