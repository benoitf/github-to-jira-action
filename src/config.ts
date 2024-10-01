import { info } from '@actions/core';
import type { Moment } from 'moment';
import moment from 'moment';
import type {
  SyncStateYaml,
  SyncYamStatusTypeMappingDefinition,
  SyncYaml,
  SyncYamlGitHubProject,
  SyncYamlIssuesTypeMappingDefinition,
} from './sync-yaml-config-file.js';

export enum ProjectConfigurationFieldType {
  Number = 'number',
  SingleSelect = 'singleSelect',
  Iteration = 'iteration',
}

export interface ProjectConfigurationGitHubField {
  alias: string;
  fieldName: string;
  type: ProjectConfigurationFieldType;
}

export interface ProjectConfigurationGitHub {
  readToken: string;
  owner: string;
  repo: string;
  project: string;
  startDate: Moment;

  projectFields: ProjectConfigurationGitHubField[];
}

export interface ProjectConfiguration {
  name: string;
  github: ProjectConfigurationGitHub;

  jira: {
    host: string;
    projectKey: string;
    writeToken: string;
    component: string;
    globalIdPrefix: string;
    sprintBoard: string;
  };
  issueTypeDefault: string;
  issueTypeMapping: SyncYamlIssuesTypeMappingDefinition[];
  statusTypeMapping: SyncYamStatusTypeMappingDefinition[];
  statusTypeDefault: string;

  maxBatchNumberIssues: number;
}

export class Configuration {
  #githubReakToken: string;
  #jiraHost: string;
  #jiraWriteToken: string;
  #syncYaml: SyncYaml;
  #syncStateYaml: SyncStateYaml | undefined;

  #statusTypeMappings: Map<string, SyncYamStatusTypeMappingDefinition[]>;
  #issueTypeMappings: Map<string, SyncYamlIssuesTypeMappingDefinition[]>;
  #githubProjects: Map<string, SyncYamlGitHubProject>;

  constructor(params: {
    githubReadToken: string;
    jiraHost: string;
    jiraWriteToken: string;
    syncYaml: SyncYaml;
    syncStateYaml?: SyncStateYaml;
  }) {
    this.#githubReakToken = params.githubReadToken;
    this.#jiraHost = params.jiraHost;
    this.#jiraWriteToken = params.jiraWriteToken;
    this.#syncYaml = params.syncYaml;
    this.#syncStateYaml = params.syncStateYaml;
    this.#statusTypeMappings = new Map();
    this.#issueTypeMappings = new Map();
    this.#githubProjects = new Map();
  }

  get githubReadToken(): string {
    return this.#githubReakToken;
  }

  init(): void {
    // build a a map from statusTypeMappings
    for (const mappingObj of this.#syncYaml.statusTypeMappings) {
      this.#statusTypeMappings.set(mappingObj.name, mappingObj.mapping);
    }

    // build a map from issuesTypeMappings
    for (const mappingObj of this.#syncYaml.issuesTypeMappings) {
      this.#issueTypeMappings.set(mappingObj.name, mappingObj.mapping);
    }

    // build a map from githubProjects
    for (const project of this.#syncYaml.githubProjects) {
      this.#githubProjects.set(project.name, project);
    }

    // override afterDate from syncStateYaml
    if (this.#syncStateYaml) {
      for (const syncProject of this.#syncStateYaml.syncProjects) {
        const project = this.#syncYaml.syncProjects.find((project) => project.name === syncProject.syncProjectName);
        if (project) {
          info(
            `Overriding afterDate for project ${project.name} from ${project.github.afterDate} to ${syncProject.afterDate}`,
          );
          project.github.afterDate = syncProject.afterDate;
        }
      }
    }
  }

  protected getFieldTypeFromYaml(type: string): ProjectConfigurationFieldType {
    switch (type) {
      case 'number':
        return ProjectConfigurationFieldType.Number;
      case 'singleSelect':
        return ProjectConfigurationFieldType.SingleSelect;
      case 'iteration':
        return ProjectConfigurationFieldType.Iteration;
      default:
        throw new Error('Unknown field type');
    }
  }

  getProjectConfigurations(): ProjectConfiguration[] {
    // need one project configuration for each project in githubProjects field of the syncYaml
    const projectConfigurations = this.#syncYaml.syncProjects.map((project) => {
      // grab agile project definition
      const agileProject = this.#githubProjects.get(project.github.project);
      const projectFields: ProjectConfigurationGitHubField[] = [];

      if (agileProject) {
        if (agileProject.storyPoints) {
          projectFields.push({
            alias: 'storyPoints',
            fieldName: agileProject.storyPoints.fieldName,
            type: this.getFieldTypeFromYaml(agileProject.storyPoints.type),
          });
        }
        if (agileProject.status) {
          projectFields.push({
            alias: 'status',
            fieldName: agileProject.status.fieldName,
            type: this.getFieldTypeFromYaml(agileProject.status.type),
          });
        }
        if (agileProject.sprint) {
          projectFields.push({
            alias: 'sprint',
            fieldName: agileProject.sprint.fieldName,
            type: this.getFieldTypeFromYaml(agileProject.sprint.type),
          });
        }
      }

      const github: ProjectConfigurationGitHub = {
        owner: project.github.owner,
        repo: project.github.repo,
        project: project.github.project,
        readToken: this.#githubReakToken,
        startDate: moment(project.github.afterDate),
        projectFields,
      };

      const jira = {
        host: this.#jiraHost,
        projectKey: project.jira.projectKey,
        writeToken: this.#jiraWriteToken,
        globalIdPrefix: project.jira.globalIdPrefix,
        sprintBoard: project.jira.sprintBoard,
        component: project.jira.component,
      };

      const maxBatchNumberIssues = project.maxBatchSize;

      const issueTypeMapping = this.#issueTypeMappings.get(project.useMapping.issueType);
      const issueTypeDefault = this.#syncYaml.issuesTypeMappings.find(
        (mapping) => mapping.name === project.useMapping.issueType,
      )?.default;

      const statusTypeMapping = this.#statusTypeMappings.get(project.useMapping.statusType);
      const statusTypeDefault = this.#syncYaml.statusTypeMappings.find(
        (mapping) => mapping.name === project.useMapping.statusType,
      )?.default;
      if (!issueTypeMapping) {
        throw new Error(`Issue type mapping not found for ${project.name}`);
      }

      if (!statusTypeMapping) {
        throw new Error(`Status type mapping not found for ${project.name}`);
      }

      if (!statusTypeDefault) {
        throw new Error(`Default status type not found for ${project.name}`);
      }

      if (!issueTypeDefault) {
        throw new Error(`Default issue type type not found for ${project.name}`);
      }

      const projectConfiguration: ProjectConfiguration = {
        name: project.name,
        jira,
        github,
        maxBatchNumberIssues,
        issueTypeDefault,
        issueTypeMapping,
        statusTypeMapping,
        statusTypeDefault,
      };

      return projectConfiguration;
    });

    return projectConfigurations;
  }
}
