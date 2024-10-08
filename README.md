# GitHub to Jira Action 🚀

Welcome to **GitHub to Jira Action**! This GitHub Action automates the synchronization of issues, sprints, story points, and statuses between GitHub Projects and Jira Projects. It helps to streamline your project management by mapping relevant fields from GitHub to Jira, so you can easily manage your tasks and track progress.

## Key Features 🌟
- Synchronize **GitHub issues** with **Jira tasks**.
- Automatically map **issue types** (Epics, Features, Bugs, etc.) from GitHub labels to Jira issue types.
- Map **sprint**, **story points**, and **status** from GitHub Projects to Jira.
- Supports **batch synchronization** with custom batch size configurations.
- **status mapping** from GitHub to Jira with default values.
  
## How It Works ⚙️
This GitHub Action reads configuration from a YAML file to map your GitHub issues and project data to corresponding fields in Jira. The tool enables seamless integration, updating Jira based on changes made in GitHub issues.

### What is Mapped?
- **Story Points**: Extracted from a GitHub custom field and synced to Jira.
- **Status**: Mapped from GitHub issue status to Jira issue status.
- **Sprints**: Synced from GitHub to the corresponding Jira sprint board.
- **Issue Types**: GitHub labels are mapped to Jira issue types (e.g., Epic, Feature, Bug, Task).

## Configuration 📋

To use **GitHub to Jira Action**, configure the tool using a YAML file that defines the mappings and project synchronization details.

Here’s a breakdown of how to configure the YAML file:

Store it under the name sync.yaml at the root folder of the repository.

### Example YAML Configuration

```yaml
# Define GitHub Project to Jira Project Mapping
githubProjects:
  - name: My Project Planning
    storyPoints:
      fieldName: Story Points
      type: number
    status:
      fieldName: Status
      type: singleSelect
    sprint:
      fieldName: Sprint
      type: iteration

statusTypeMappings:
  - name: My Status Mapping
    default: Backlog
    mapping:
      - fromGithub: 📋 Backlog
        toJira: Backlog
      - fromGithub: 📅 Planned
        toJira: Backlog
      - fromGithub: 🚧 In Progress
        toJira: In Progress
      - fromGithub: 🚥 In Review
        toJira: Review
      - fromGithub: ⏳ On Hold
        toJira: Backlog
      - fromGithub: ✔️ Done
        toJira: Closed

issuesTypeMappings:
  - name: My Issue Mapping
    default: Task
    mapping:
      - fromGithubLabel: kind/epic ⚡
        toJira: Epic
      - fromGithubLabel: kind/bug 🐞
        toJira: Bug
      - fromGithubLabel: kind/task ☑️
        toJira: Task

syncProjects:
  - name: "Podman Desktop"
    github:
      owner: my-organization-on-github
      repo: my-repository-name
      # the name of the GitHub Project v2 defining all sprints
      project: My Project Planning
      # start sync from every issue updated after this date
      # after the first run, it'll be changed in the state
      # to a more recent date
      afterDate: 2024-04-25
    useMapping:
     issueType: My Issue Mapping
     statusType: My Status Mapping
    jira:
      projectKey: MY-JIRA-PROJECT-KEY
      component: My Component
      sprintBoard: Jira board name
    # maximum number of issues to synchronize at each batch for this project
    maxBatchSize: 50
```


## Fields to Configure 📋

- **githubProjects**: Lists the GitHub projects to sync with Jira.
  - **storyPoints**: The field used to map story points.
  - **status**: The GitHub status field that corresponds to Jira statuses.
  - **sprint**: Maps the sprint between GitHub and Jira.

- **statusTypeMappings**: Defines how GitHub issue statuses are mapped to Jira statuses.
  - **default**: Default Jira status if no mapping is found.
  - **mapping**: Individual mappings for GitHub to Jira status.

- **issuesTypeMappings**: Maps GitHub issue labels to Jira issue types.
  - **default**: The default Jira issue type for unmapped issues.
  - **mapping**: Mappings between GitHub labels and Jira issue types.

- **syncProjects**: Defines synchronization details for each GitHub and Jira project.
  - **github**: The GitHub repository and project to sync.
  - **jira**: The Jira project key and other Jira-specific details.
  - **maxBatchSize**: Limits the number of issues synced per batch.

---

## How to Use 🚀

### Step 1: Create a GitHub Workflow

```yaml
on:
  push:
    branches:
      - main
  # every hour    
  schedule:
    - cron: '0 * * * *'
  workflow_dispatch:

name: Sync GitHub to Jira

jobs:
  sync:
    runs-on: ubuntu-24.04
    steps:
      - uses: actions/checkout@v4
      - name: Restore state from previous run using GitHub variables (no secret inside)
        run: |
          if [ -z "${{ vars.SYNC_STATE }}" ]; then
            echo "no previous persisted state"
          else
            echo "restoring previous sync state"
            echo "${{ vars.SYNC_STATE }}" > sync-state.yaml
            cat sync-state.yaml
          fi

        # use development branch of the action (next is the build from the main branch)
      - name: Run GitHub to Jira Action
        uses: benoitf/github-to-jira-action@next
        with:
          jira-host: ${{ secrets.JIRA_HOST }}
          jira-write-token: ${{ secrets.JIRA_WRITE_TOKEN }}
          github-read-token: ${{ secrets.GITHUB_TOKEN }}

        # save the state using a custom token as default GITHUB_TOKEN does not have the required permissions
        # to save variables
      - name: persist state
        env:
          GH_TOKEN: ${{ secrets.SET_VARIABLE_GITHUB_TOKEN }}
        run: |
          # use gh cli to save the content of a file into a variable
          gh variable set SYNC_STATE < sync-state.yaml
```

It is using GitHub variables to store the state between each run. GitHub Actions don't have permissions for that,
so write access needs to be granted to the step `persist state`.
In the example above, `GH_TOKEN: ${{ secrets.SET_VARIABLE_GITHUB_TOKEN }}` is granting that permission.

From GitHub UI it is then possible to view the current state of each repo sync (and optionally delete it).

---

### Step 2: Add the YAML Configuration

Copy the above workflow YAML to a workflow file in your repository (e.g., `.github/workflows/execute-sync.yaml`).

Place your `github-to-jira-action` YAML configuration file in `sync.yaml`.

### Step 3: Configure Secrets 🔐

You need to provide Jira credentials and GitHub tokens as secrets in your repository:

1. Go to **Settings > Secrets > Actions** in your GitHub repository.
2. Add the following secrets:
   - **JIRA_WRITE_TOKEN**: Your Jira Rest API token to write.
   - **JIRA_HOST**: The base URL of your Jira instance.

The **GITHUB_TOKEN** secret is one from the default GitHub Actions. It is ok to use this token if all GitHub projects/issues data are publicly available.

---

### Step 4: Ensure JIRA scheme/components are valid in JIRA project

 - Ensure `Story Points` field is available on every issue type.
 - Ensure the issues types are available in the JIRA project (by default it may only be a subset like only `Bug` and `Task`).
 - Ensure the statuses/transitions (`CLOSED`/`IN PROGRESS`/etc.) are available in the JIRA project.
 - Ensure that the component(s) referenced in the configuration YAML file exist in the JIRA project.

---

### Step 5: Run the Action

Once the workflow and configuration file are committed to the repository, the
action will automatically run based on your schedule.  It will also be triggered
when you merge updates (such as configuration changes) to the repository `main`
branch.  And, you can manually trigger it from the **Actions** tab in your
repository GitHub page.

---

## Advanced Options 🛠️

- **Max Batch Size**: Control how many issues are synced in one batch. Set `maxBatchSize` to `0` for turn it off.
- **Status Mappings**: Customize how GitHub statuses (e.g., "📋 Backlog", "🚧 In Progress") are mapped to Jira statuses.
- **Date Filtering**: Use the `afterDate` field to only sync issues created after a specific date.

---

## Troubleshooting ❓

- **Authentication Issues**: Ensure your Jira API token and GitHub tokens are correctly configured in GitHub secrets.
- **Sync Errors**: Check the logs in the **Actions** tab for detailed information on any errors during synchronization.
- **Always syncing the same issues**: Check the save/restore part of the state. Without state, it is always starting from the same date.
---

## Conclusion 🎉

With **GitHub to Jira Action**, you can seamlessly synchronize your project tasks, statuses, and more between GitHub and Jira. Get started today to keep your workflow smooth and efficient!
