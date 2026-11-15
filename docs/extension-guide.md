# LeetTrack

A local-first Chrome extension that tracks completed LeetCode problems and syncs accepted solutions to a GitHub repository you choose. It uses the LeetCode tab you are already signed in to only when you choose to sync.

## What it does

- Detects an **Accepted** result on an open LeetCode problem and records it locally.
- Asks to sync your completed problem list when you open a LeetCode tab. Only problems LeetCode marks **Solved** are included in the progress README.
- Saves accepted submission code from your LeetCode history to your GitHub repository when solution sync is enabled.
- Organizes each answer under a language folder and a problem folder, with a problem card linking the question and answer.
- Refreshes a colorful `README.md` with solved counts, colored difficulty badges, completed questions, and answer links grouped by language.
- Lets you manually sync the current accepted solution or update the README from the extension popup.
- Tracks goals, streaks, activity, search, and spaced review reminders locally.
- Exports and restores a JSON backup.

## Your live progress README

The README in your connected GitHub repository is generated from problems confirmed as completed by LeetCode or explicitly marked solved by you. Older imported entries without completion confirmation are left out. Open LeetCode and choose **Sync completed problems** to refresh the list and upload accepted answers, or select **Update README now** in the popup. New accepted submissions update it automatically while automatic README sync is enabled. You can change the destination path in settings.

This file in the extension folder is the installation and project guide. The live progress list is written to the repository you connect in the popup, not to this local guide.

## Install locally

1. Open Chrome and go to `chrome://extensions`.
2. Turn on **Developer mode**.
3. Choose **Load unpacked** and select this folder.
4. Pin LeetTrack from the Extensions menu.

## Connect GitHub

1. Open the extension popup and enter your own repository as `owner/repo`.
2. Create a fine-grained personal access token limited to that repository, with **Contents: Read and write** permission.
3. Select **Connect & initialize README**. LeetTrack verifies write access, then creates or updates the repository's `README.md`.
4. Open a LeetCode tab and choose **Sync completed problems** to build the README from your LeetCode progress list. After that, each new accepted result saves the current editor code and refreshes the README automatically. Turn either behavior off in the popup if you prefer.

Accepted answers are stored like `LeetCode/Python/two-sum/solution.py`; each problem folder also has a `README.md` with its LeetCode question link, difficulty, accepted date, and answer link. The generated repository README includes colorful completion and difficulty badges, a completed-problems table, and answer tables grouped by language. If a solution already exists, GitHub updates that file.

The token is stored in Chrome's local extension storage and sent to GitHub's API for the repository actions you trigger. LeetTrack does not preselect or connect the reference repository.

## Data and permissions

- Problems and settings stay in the browser's extension storage.
- When you select **Sync completed problems**, the current LeetCode tab fetches your solved-problem list and accepted submission code using your existing signed-in session. The extension does not ask for your password or read or store your cookies.
- If solution sync is enabled, the latest accepted answer found for each completed problem and language is uploaded to your selected GitHub repository.
- GitHub API access is used to verify the repository and publish solution files and the README.
- Open **Settings → Your data** to export or import a backup, or disconnect GitHub.
