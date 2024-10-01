export type SyncYamlGitHubProjectFieldType = 'number' | 'singleSelect' | 'iteration';

export interface SyncYamlGitHubProject {
  name: string;

  storyPoints: {
    fieldName: string;
    type: SyncYamlGitHubProjectFieldType;
  };

  status: {
    fieldName: string;
    type: SyncYamlGitHubProjectFieldType;
  };

  sprint: {
    fieldName: string;
    type: SyncYamlGitHubProjectFieldType;
  };
}

export interface SyncYamStatusTypeMappingDefinition {
  fromGithub: string;
  toJira: string;
}

export interface SyncYamStatusTypeMapping {
  name: string;
  default: string;
  mapping: SyncYamStatusTypeMappingDefinition[];
}

export interface SyncYamlIssuesTypeMappingDefinition {
  fromGithubLabel: string;
  toJira: string;
}

export interface SyncYamlIssuesTypeMapping {
  name: string;
  default: string;
  mapping: SyncYamlIssuesTypeMappingDefinition[];
}

export interface SyncYamlSyncProject {
  name: string;
  github: {
    owner: string;
    repo: string;
    project: string;
    afterDate: string;
  };
  useMapping: {
    issueType: string;
    statusType: string;
  };
  jira: {
    projectKey: string;
    component: string;
    globalIdPrefix: string;
    sprintBoard: string;
  };
  maxBatchSize: number;
}

export interface SyncYaml {
  githubProjects: SyncYamlGitHubProject[];

  statusTypeMappings: SyncYamStatusTypeMapping[];

  issuesTypeMappings: SyncYamlIssuesTypeMapping[];

  syncProjects: SyncYamlSyncProject[];
}

export interface SyncStateYaml {
  syncProjects: {
    syncProjectName: string;
    afterDate: string;
  }[];
}
