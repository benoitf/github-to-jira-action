import { debug, warning } from '@actions/core';
import { AgileClient, type Paginated, Version2Client } from 'jira.js';
import type { Sprint } from 'jira.js/out/agile/models/sprint.js';
import type { CreateSprint } from 'jira.js/out/agile/parameters/createSprint.js';
import type { Project } from 'jira.js/out/version2/models/project.js';
import type { ProjectComponent } from 'jira.js/out/version2/models/projectComponent.js';
import type { Version } from 'jira.js/out/version2/models/version.js';
import type { CreateVersion } from 'jira.js/out/version2/parameters/createVersion.js';
import type { ProjectConfiguration } from './config.js';

export interface CreateIssueParamsMilestone {
  name: string;
  startDate: string;
  releaseDate: string;
  closed: true;
}
export interface CreateIssueParams {
  title: string;
  body: string;
  state: string;
  issuetype: string;
  status: string;
  storyPoints?: number;
  fixVersionId?: string;
  sprintBoardId?: number;
  jiraProjectKey: string;

  globalId: string;
  remoteLinkUrl: string;
  remoteLinkTitle: string;
}

export interface CreateReleaseParams {
  name: string;
  released: boolean;
  releaseDate?: string;
}

export interface CreateSprintParams {
  name: string;
  startDate: string;
  endDate: string;
}

export interface UpdateReleaseParams {
  id: string;
  projectId: number;
  name: string;
  released: boolean;
  releaseDate?: string;
}

export interface UpdateSprintParams {
  sprintId: number;
  name: string;
  startDate: string;
  endDate: string;
}

export class Jira {
  #client: Version2Client;
  #agileClient: AgileClient;

  #projectConfiguration: ProjectConfiguration;

  #storyPointsFieldId: string | undefined;
  #epicNameFieldId: string | undefined;

  #project: Project | undefined;

  #components: ProjectComponent[] = [];

  #boardId: number | undefined;

  constructor(projectConfiguration: ProjectConfiguration) {
    this.#projectConfiguration = projectConfiguration;

    const jiraConfig = {
      host: this.#projectConfiguration.jira.host,
      authentication: {
        personalAccessToken: this.#projectConfiguration.jira.writeToken,
      },
    };

    // create client
    this.#client = new Version2Client(jiraConfig);
    this.#agileClient = new AgileClient(jiraConfig);
  }

  async checkJiraConnection(): Promise<boolean> {
    try {
      await this.#client.myself.getCurrentUser();
      return true;
    } catch (e) {
      console.error('Jira connection error', e);
      return false;
    }
  }

  async initAndCheck(): Promise<void> {
    // check the connection to Jira
    const jiraConnected = await this.checkJiraConnection();
    if (!jiraConnected) {
      throw new Error('Jira connection error');
    }

    // get JIRA project
    this.#project = await this.#client.projects.getProject({
      projectIdOrKey: this.#projectConfiguration.jira.projectKey,
    });

    // ok now get all issue types
    const existingIssueTypes = (this.#project?.issueTypes?.map((issueType) => issueType.name) ?? []).filter(
      (item) => item !== undefined,
    );

    //get the statuses required from the configuration
    const wantedIssueTypes = this.#projectConfiguration.issueTypeMapping?.map((status) => status.toJira) ?? [];

    // check that all wanted statuses are in Jira
    for (const wantedIssueType of wantedIssueTypes) {
      if (!existingIssueTypes.includes(wantedIssueType)) {
        throw new Error(
          `Issue type "${wantedIssueType}" not found in Jira to sync the project ${this.#projectConfiguration.name}`,
        );
      }
    }

    // check if the wanted component exists
    this.#components = await this.#client.projectComponents.getProjectComponents({
      projectIdOrKey: this.#projectConfiguration.jira.projectKey,
    });
    const wantedComponent = this.#projectConfiguration.jira.component;
    const componentExists = this.#components.find((component) => component.name === wantedComponent);
    if (!componentExists) {
      throw new Error(
        `Component "${wantedComponent}" not found in Jira to sync the project ${this.#projectConfiguration.name}`,
      );
    }

    const fields = await this.#client.issueFields.getFields();

    // search for the field named 'Story Points'
    const storyPointsField = fields.find((field) => field.name === 'Story Points');
    if (!storyPointsField || !storyPointsField.id) {
      throw new Error('Story Points field cannot be found');
    }
    this.#storyPointsFieldId = storyPointsField.id;

    // search for the field named 'Epic Name'
    const epicNameField = fields.find((field) => field.name === 'Epic Name');
    if (!epicNameField || !epicNameField.id) {
      throw new Error('Epic Name field cannot be found');
    }
    this.#epicNameFieldId = epicNameField.id;
  }

  async getReleases(): Promise<Version[]> {
    // list all releases from JIRA
    return this.#client.projectVersions.getProjectVersions({
      projectIdOrKey: this.#projectConfiguration.jira.projectKey,
    });
  }

  protected async doGetAllSprintsByBoardId(boardId: number): Promise<Sprint[]> {
    let allSprints: Sprint[] = [];
    let startAt = 0;
    const maxResults = 50;

    let response: Paginated<Sprint>;
    do {
      response = await this.#agileClient.board.getAllSprints({
        boardId,
        startAt,
        maxResults,
      });

      // append
      allSprints = allSprints.concat(response.values);

      // update
      startAt += response.values.length;
    } while (!response.isLast); // Continue while there are more sprints to fetch

    return allSprints;
  }

  async getSprints(): Promise<Sprint[]> {
    // list all releases from JIRA
    const boards = await this.#agileClient.board.getAllBoards({
      projectKeyOrId: this.#projectConfiguration.jira.projectKey,
    });

    // filter the expected board
    const board = boards.values?.find((b) => b.name === this.#projectConfiguration.jira.sprintBoard);
    if (!board?.id) {
      throw new Error(
        `Board with name ${this.#projectConfiguration.jira.sprintBoard} not found for project ${this.#projectConfiguration.jira.projectKey}`,
      );
    }

    this.#boardId = board.id;

    // get sprints
    return this.doGetAllSprintsByBoardId(board.id);
  }

  async createSprint(sprint: CreateSprintParams): Promise<void> {
    if (!this.#boardId) {
      throw new Error('Board id not initialized, cannot create sprint');
    }

    const params: CreateSprint = {
      originBoardId: this.#boardId,
      name: sprint.name,
      startDate: sprint.startDate,
      endDate: sprint.endDate,
    };

    await this.#agileClient.sprint.createSprint(params);
  }

  async updateSprint(params: UpdateSprintParams): Promise<void> {
    await this.#agileClient.sprint.updateSprint(params);
  }

  async createRelease(release: CreateReleaseParams): Promise<void> {
    if (!this.#project) {
      throw new Error('Project not initialized, cannot create release');
    }
    const projectId = Number(this.#project.id);

    const params: CreateVersion = {
      projectId,
      name: release.name,
      released: release.released,
      releaseDate: release.releaseDate,
    };

    await this.#client.projectVersions.createVersion(params);
  }

  async updateRelease(params: UpdateReleaseParams): Promise<void> {
    await this.#client.projectVersions.updateVersion(params);
  }

  async findExistingGithubIssueInJira(remoteId: string): Promise<string | undefined> {
    // jql to search for an issue having the remote link with globalId (the github issue number)
    const jql = `issue in issuesWithRemoteLinksByGlobalId("${remoteId}") and project = "${this.#projectConfiguration.jira.projectKey}"`;
    const query = { jql, maxResults: 1 };
    const issues = await this.#client.issueSearch.searchForIssuesUsingJql(query);
    return issues.issues?.[0]?.key;
  }

  async createOrUpdateIssue(createOrUpdateIssueParams: CreateIssueParams): Promise<{ key: string }> {
    if (!this.#storyPointsFieldId) {
      throw new Error('Story Points field not initialized, cannot create or update issue');
    }

    if (!this.#epicNameFieldId && createOrUpdateIssueParams.issuetype === 'Epic') {
      throw new Error('Epic Name field not initialized, cannot create or update issue');
    }

    debug(
      `  🧪 Creating issue in Jira Type/${createOrUpdateIssueParams.issuetype} status/${createOrUpdateIssueParams.status} state/${createOrUpdateIssueParams.state} fixVersionID ${createOrUpdateIssueParams.fixVersionId} sprintBoardId/${createOrUpdateIssueParams.sprintBoardId}`,
    );

    // fields that may be mandatory for certain type of fields
    const createOptionalFields: Record<string, unknown> = {};

    // epic name
    if (this.#epicNameFieldId && createOrUpdateIssueParams.issuetype === 'Epic') {
      createOptionalFields[this.#epicNameFieldId] = createOrUpdateIssueParams.title;
    }

    // create the REST API parameters
    const createParams = {
      fields: {
        ...createOptionalFields,
        summary: createOrUpdateIssueParams.title,
        project: {
          key: createOrUpdateIssueParams.jiraProjectKey,
        },
        issuetype: {
          name: createOrUpdateIssueParams.issuetype,
        },
      },
    };

    const existingKey = await this.findExistingGithubIssueInJira(createOrUpdateIssueParams.globalId);

    // create issue in Jira or update if already exists
    let issueKey: string;
    if (!existingKey) {
      const result = await this.#client.issues.createIssue(createParams);
      issueKey = result.key;
    } else {
      issueKey = existingKey;
    }

    // update the remote link
    await this.#client.issueRemoteLinks.createOrUpdateRemoteIssueLink({
      issueIdOrKey: issueKey,
      globalId: createOrUpdateIssueParams.globalId,
      object: {
        url: createOrUpdateIssueParams.remoteLinkUrl,
        title: createOrUpdateIssueParams.remoteLinkTitle,
        icon: {
          url16x16: 'https://github.githubassets.com/favicons/favicon.svg',
          title: 'GitHub',
        },
      },
    });

    // optional fields that can be defined for updating an issue
    const updateOptionalFields: Record<string, unknown> = {};

    // story points ?
    if (this.#storyPointsFieldId) {
      updateOptionalFields[this.#storyPointsFieldId] = createOrUpdateIssueParams.storyPoints ?? 1;
    }

    let fixVersions: { id: string }[] | undefined = [];
    if (createOrUpdateIssueParams.fixVersionId) {
      fixVersions = [{ id: createOrUpdateIssueParams.fixVersionId }];
    }

    // grab component id from the components
    const findComponent = this.#components.find((c) => c.name === this.#projectConfiguration.jira.component);
    let component: { id: string } | undefined;
    if (findComponent?.id) {
      component = { id: findComponent.id };
    }

    const components = component ? [component] : undefined;

    // update the issue with the story points, body, etc
    const updateFields = {
      ...createParams.fields,
      ...updateOptionalFields,
      components,
      description: createOrUpdateIssueParams.body,
      fixVersions,
    };

    await this.#client.issues.editIssue({
      issueIdOrKey: issueKey,
      fields: updateFields,
    });

    // do the transitions for the status
    const toStatus = createOrUpdateIssueParams.status;

    // get current status of the issue
    const issue = await this.#client.issues.getIssue({ issueIdOrKey: issueKey });
    const currentStatus = issue.fields?.status?.name;

    // if the status is the same, no need to update
    if (currentStatus?.toLowerCase() !== toStatus.toLowerCase()) {
      await this.updateIssueStatusTo(issueKey, toStatus);
    } else {
      debug(`  🧪 Issue ${issueKey} already in status ${toStatus}, skipping`);
    }

    // if sprint id, need to add the issue to the sprint
    if (createOrUpdateIssueParams.sprintBoardId) {
      await this.#agileClient.sprint.moveIssuesToSprintAndRank({
        sprintId: createOrUpdateIssueParams.sprintBoardId,
        issues: [issueKey],
      });
    }

    return { key: issueKey };
  }

  async getTransitionId(issueKey: string, targetStatus: string): Promise<string | undefined> {
    const transitions = await this.#client.issues.getTransitions({ issueIdOrKey: issueKey });

    // Find the transition to the target status (e.g., "NEW")
    const transition = transitions.transitions?.find((t) => t.to?.name?.toLowerCase() === targetStatus.toLowerCase());

    return transition?.id;
  }

  async updateIssueStatusTo(issueKey: string, newStatus: string) {
    const transitionId = await this.getTransitionId(issueKey, newStatus);

    if (!transitionId) {
      throw new Error(`Transition to status "${newStatus}" not found`);
    }

    // Perform the transition
    await this.#client.issues.doTransition({
      issueIdOrKey: issueKey,
      transition: { id: transitionId },
    });
  }
}
