import { debug, endGroup, info, startGroup, warning } from '@actions/core';
import { HttpException } from 'jira.js';
import * as jira2md from 'jira2md';
import moment from 'moment';
import type { ProjectConfiguration } from './config.js';
import {
  GitHub,
  type GraphQLSearchIssuesNode,
  type GraphQLSearchIssuesNodeMilestone,
  type GraphQLSearchIssuesNodeSprint,
} from './github.js';
import { type CreateIssueParams, type CreateReleaseParams, type CreateSprintParams, Jira } from './jira.js';

/**
 * Handle the synchronization of a GitHub repository to a Jira project
 */
export class SyncRepository {
  #github: GitHub;

  #jira: Jira;

  #projectConfiguration: ProjectConfiguration;

  // map between the name of the fixVersion in Jira and the id
  #fixVersions: Map<string, string | undefined> = new Map();

  // map between the name of the sprint in Jira and the id
  #sprints: Map<string, number> = new Map();

  constructor(projectConfiguration: ProjectConfiguration) {
    this.#projectConfiguration = projectConfiguration;
    this.#github = new GitHub(this.#projectConfiguration);

    this.#jira = new Jira(this.#projectConfiguration);
  }

  protected fromGithubMilestoneToJiraRelease(githubMilestone: GraphQLSearchIssuesNodeMilestone): CreateReleaseParams {
    // keep only the left part of the date (YYYY-MM-DD)
    const releaseDate = githubMilestone.dueOn ? new Date(githubMilestone.dueOn).toISOString().split('T')[0] : undefined;

    const jiraRelease: CreateReleaseParams = {
      name: githubMilestone.title,
      released: githubMilestone.closed ?? false,
      releaseDate,
    };
    return jiraRelease;
  }

  async syncReleases(issues: GraphQLSearchIssuesNode[]): Promise<void> {
    // get all existing releases in Jira
    const jiraReleases = await this.#jira.getReleases();

    // get all milestones from all issues that we need to handle
    const githubReleases = issues
      .flatMap((issue) => issue.milestone)
      .filter((m) => m !== undefined)
      .filter((m) => m?.id);

    // remove any duplicates
    const githubReleasesWithoutDuplicates = githubReleases.filter((m, index) => {
      return githubReleases.findIndex((m2) => m2?.title === m?.title) === index;
    });

    // add the name of the project to the milestone as prefix
    const githubReleasesWithProjectPrefix = githubReleasesWithoutDuplicates.map((release) => {
      return {
        ...release,
        title: `${this.#projectConfiguration.name} ${release.title}`,
      };
    });

    // get all the releases that are not in Jira
    const releasesToCreate = githubReleasesWithProjectPrefix.filter((release) => {
      return !jiraReleases.find((r) => r.name === release.title);
    });
    // create the releases in Jira
    for (const release of releasesToCreate) {
      const jiraRelease = this.fromGithubMilestoneToJiraRelease(release);
      this.#jira.createRelease(jiraRelease);
    }

    // now, update all the fields if it differs
    for (const release of githubReleasesWithoutDuplicates) {
      const jiraRelease = jiraReleases.find((r) => r.name === release.title);
      if (!jiraRelease) {
        continue;
      }

      // now compare the fields
      const fromGithub = this.fromGithubMilestoneToJiraRelease(release);
      if (
        jiraRelease.name !== fromGithub.name ||
        jiraRelease.released !== fromGithub.released ||
        jiraRelease.releaseDate !== fromGithub.releaseDate
      ) {
        const updatedRelease = {
          ...jiraRelease,
          id: jiraRelease.id ?? '',
          name: fromGithub.name,
          released: fromGithub.released,
          releaseDate: fromGithub.releaseDate,
        };
        await this.#jira.updateRelease(updatedRelease);
      }
    }

    // ok, refresh the list of releases
    const jiraReleasesAfterUpdate = await this.#jira.getReleases();
    for (const release of jiraReleasesAfterUpdate) {
      this.#fixVersions.set(release.name ?? release.id ?? 'unknown', release.id);
    }
  }

  /**
   * Convert a GitHub sprint to a Jira sprint
   * @param githubSprint the GitHub sprint
   * @returns the Jira sprint parameters
   */
  protected fromGithubSprintToJiraSprint(githubSprint: GraphQLSearchIssuesNodeSprint): CreateSprintParams {
    // keep only the left part of the date (YYYY-MM-DD)
    const startDate: string = new Date(githubSprint.startDate).toISOString();
    const endDate: string = moment(startDate).add(githubSprint.duration, 'day').toISOString();

    const jiraRelease: CreateSprintParams = {
      name: githubSprint.title,
      startDate,
      endDate,
    };
    return jiraRelease;
  }

  /**
   * Sync the sprints from GitHub to Jira
   * @param issues the issues containing the sprints to create or update
   */
  async syncSprints(issues: GraphQLSearchIssuesNode[]): Promise<void> {
    // get all existing sprints in Jira
    const jiraSprints = await this.#jira.getSprints();

    // get all sprints from all issues that we need to handle
    const filteredGithubSprints = issues
      .flatMap((issue) => issue.projectItems.projects)
      // keep only the projects not null
      .filter((p) => p !== null)
      .filter((p) => p.project.sprint !== undefined)
      .filter((p) => p.project.title?.name === this.#projectConfiguration.github.project);

    // keep only .project.sprint fields that are defined
    const githubSprints = filteredGithubSprints
      .filter((s) => s.project.sprint !== undefined)
      .map((s) => s.project.sprint)
      .filter((s) => s !== undefined)
      .filter((s) => s?.title);

    // remove any duplicates from githubSprints
    const githubSprintsWithoutDuplicates = githubSprints.filter((s, index) => {
      return githubSprints.findIndex((s2) => s2?.title === s?.title) === index;
    });

    // get all the sprints that are not in Jira
    const sprintsToCreateInJira = githubSprintsWithoutDuplicates
      .filter((sprint) => {
        return !jiraSprints.find((j) => j.name === sprint.title);
      })
      .filter((s) => s.startDate && s.duration);
    // create the sprint in Jira
    for (const sprintToCreate of sprintsToCreateInJira) {
      const jiraSprint = this.fromGithubSprintToJiraSprint(sprintToCreate);
      await this.#jira.createSprint(jiraSprint);
    }

    // now, update all the fields if it differs
    for (const githubSprint of githubSprintsWithoutDuplicates) {
      // matching sprint in Jira
      const jiraSprint = jiraSprints.find((r) => r.name === githubSprint.title);
      if (!jiraSprint) {
        continue;
      }

      // now compare the fields
      const fromGithub = this.fromGithubSprintToJiraSprint(githubSprint);

      // do not compare timezone (GitHub does not provide it and Jira has it so ignore it for comparison)
      const shortGithubStartDate = fromGithub.startDate.split('T')[0];
      const shortJiraStartDate = jiraSprint.startDate?.split('T')[0];

      const shortGithubEndDate = fromGithub.endDate.split('T')[0];
      const shortJiraEndDate = jiraSprint.endDate?.split('T')[0];

      if (
        jiraSprint.name !== fromGithub.name ||
        shortJiraStartDate !== shortGithubStartDate ||
        shortGithubEndDate !== shortJiraEndDate
      ) {
        const updatedSprint = {
          ...jiraSprint,
          sprintId: jiraSprint.id ?? 0,
          name: fromGithub.name,
          startDate: fromGithub.startDate,
          endDate: fromGithub.endDate,
        };
        await this.#jira.updateSprint(updatedSprint);
      }
    }

    // ok, refresh the list of sprints
    const jiraSprintsAfterUpdate = await this.#jira.getSprints();
    for (const sprint of jiraSprintsAfterUpdate) {
      this.#sprints.set(sprint.name ?? sprint.id ?? 'unknown', sprint.id);
    }
  }

  async start(): Promise<{ afterDate: string }> {
    startGroup('🚥 Init and sync...');
    // check JIRA is connected and do checks
    info('Check JIRA is available');
    await this.#jira.initAndCheck();

    // get all the issues from GitHub that have been updated since a given date
    info('Grab recent issues being updated...');
    const recentIssuesSearch = await this.#github.getIssuesUpdatedAfter();

    info('Sync releases...');
    await this.syncReleases(recentIssuesSearch.issues);

    info('Sync sprint...');
    await this.syncSprints(recentIssuesSearch.issues);

    endGroup();

    startGroup('🚀 Create or update issues in Jira...');

    // for each issue
    for (const issue of recentIssuesSearch.issues) {
      // check if the issue exists in Jira

      // build the globalId from this issue
      // the globalId is the github issue number prefixed by the repository name all in upper-case
      const globalId = `${this.#projectConfiguration.jira.globalIdPrefix}-${issue.number}`;

      // create the issue in Jira
      info(`🔥 Create or update issue ${issue.url} in Jira...`);

      // get the labels of the issue
      const labels = issue.labels.nodes.map((n) => n.name);

      // the remote link title is based from the name of the repository, taking first letters separated by a dash
      // then making it upper case and adding the issue number
      // for example: `PD #123` if the repository is `podman-desktop`
      const remoteLinkTitle = `${this.#projectConfiguration.github.repo
        .split('-')
        .map((w) => w.charAt(0).toUpperCase())
        .join('')} #${issue.number}`;

      // fixVersionId from the milestone
      let fixVersionId: string | undefined;
      if (issue.milestone) {
        const prefixedMilestone = `${this.#projectConfiguration.name} ${issue.milestone.title}`;
        fixVersionId = this.#fixVersions.get(prefixedMilestone);
      }

      const projectData = issue.projectItems.projects.find(
        (p) => p.project.title?.name === this.#projectConfiguration.github.project,
      );

      const projectStatus = projectData?.project.status?.name;
      const status = this.getJiraStatusFromGithubProject(projectStatus);
      const storyPoints = projectData?.project.storyPoints?.value;

      const sprintName = projectData?.project.sprint?.title;
      let sprintBoardId: number | undefined;
      if (sprintName) {
        sprintBoardId = this.#sprints.get(sprintName);
      }
      // convert the body from Markdown to Jira
      const body = jira2md.default.to_jira(issue.body);

      // data to create the issue in Jira
      const issueToCreate: CreateIssueParams = {
        title: issue.title,
        body,
        state: issue.state,
        issuetype: this.getJiraIssueTypeFromGitHubLabels(labels),
        status,
        fixVersionId,
        sprintBoardId,
        globalId,
        remoteLinkUrl: issue.url,
        remoteLinkTitle,
      };

      if (storyPoints) {
        issueToCreate.storyPoints = storyPoints;
      }

      // create the issue in Jira
      try {
        await this.#jira.createOrUpdateIssue(issueToCreate);
      } catch (error: unknown) {
        debug(`Error creating issue in Jira ${error}`);
        // check if the error is a HttpException error
        if (error instanceof HttpException) {
          const httpException = error as HttpException;
          // check if the error is related to throttling
          if (
            httpException.status === 401 &&
            httpException.statusText === 'Unauthorized' &&
            httpException.code === 'ERR_BAD_REQUEST'
          ) {
            // pause for 30s and retry after
            warning('Jira unauthorized/throttling rate limit reached, pausing for 30s before retrying');
            await new Promise((resolve) => setTimeout(resolve, 30000));
            await this.#jira.createOrUpdateIssue(issueToCreate);
          }
        }
      }
    }
    endGroup();
    return { afterDate: recentIssuesSearch.afterDate };
  }

  async stop() {}

  /**
   * Gets the Jira issue type from the GitHub labels
   * @param labels the GitHub labels
   * @returns matching Jira issue type or the default one
   */
  getJiraIssueTypeFromGitHubLabels(labels: string[]): string {
    // do we have an issue mapping ?
    const issueTypeMapping = this.#projectConfiguration.issueTypeMapping;
    if (issueTypeMapping) {
      for (const mapping of issueTypeMapping) {
        if (labels.includes(mapping.fromGithubLabel)) {
          return mapping.toJira;
        }
      }
    }

    // not found, default
    return this.#projectConfiguration.issueTypeDefault;
  }

  /**
   * Gets the Jira status from the GitHub project status
   * @param githubStatus the GitHub project status
   * @returns matching Jira status or the default one
   */
  getJiraStatusFromGithubProject(githubStatus?: string): string {
    // do we have a status mapping ?
    const statusTypeMapping = this.#projectConfiguration.statusTypeMapping;
    if (statusTypeMapping) {
      for (const mapping of statusTypeMapping) {
        if (githubStatus === mapping.fromGithub) {
          return mapping.toJira;
        }
      }
    }

    // not found, default
    return this.#projectConfiguration.statusTypeDefault;
  }
}
