import { debug } from '@actions/core';
import { getOctokit } from '@actions/github';
import type { GitHub as OctokitGitHub } from '@actions/github/lib/utils.js';
import { graphql } from '@octokit/graphql';
import type { ProjectConfiguration, ProjectConfigurationFieldType } from './config.js';

export interface GraphQLSearchIssuesNodeMilestone {
  id: string;
  dueOn?: string;
  closed?: boolean;
  title: string;
}

export interface GraphQLSearchIssuesNodeSprint {
  title: string;
  duration: number;
  startDate: string;
}

export interface GraphQLSearchIssuesNode {
  url: string;
  number: number;
  state: string;
  updatedAt: string;
  body: string;
  title: string;
  labels: {
    nodes: { name: string }[];
  };
  milestone?: GraphQLSearchIssuesNodeMilestone;
  projectItems: {
    projects: {
      project: {
        title?: {
          name: string;
        };
        status?: {
          name: string;
        };
        sprint?: GraphQLSearchIssuesNodeSprint;
        storyPoints: {
          value: number;
        };
      };
    }[];
  };
}

export interface GraphQLSearchIssuesResponse {
  rateLimit: {
    cost: number;
    remaining: number;
    resetAt: string;
  };

  search: {
    pageInfo: {
      startCursor: string;
      endCursor: string;
      hasNextPage: boolean;
    };
    edges: {
      node: GraphQLSearchIssuesNode[];
    }[];
  };
}

export class GitHub {
  #projectConfiguration: ProjectConfiguration;
  #githubReadAccess: InstanceType<typeof OctokitGitHub>;

  constructor(projectConfiguration: ProjectConfiguration) {
    this.#projectConfiguration = projectConfiguration;
    this.#githubReadAccess = getOctokit(this.#projectConfiguration.github.readToken);
  }

  async getIssuesUpdatedAfter(): Promise<{
    owner: string;
    repo: string;
    afterDate: string;
    issues: GraphQLSearchIssuesNode[];
  }> {
    const issues = await this.doGetIssuesUpdatedAfterBatch();

    // startDate will be the last updated date of the last issue
    let nextStartDate: string = this.#projectConfiguration.github.startDate.toISOString();
    const lastItem = issues[issues.length - 1];
    if (lastItem) {
      nextStartDate = lastItem.updatedAt;
    }

    return {
      owner: this.#projectConfiguration.github.owner,
      repo: this.#projectConfiguration.github.repo,
      afterDate: nextStartDate,
      issues,
    };
  }

  foo() {
    this.#githubReadAccess.rest.issues.listForRepo({
      owner: this.#projectConfiguration.github.owner,
      repo: this.#projectConfiguration.github.repo,
    });
  }

  protected async doGetIssuesUpdatedAfterBatch(
    cursor?: string,
    previousIssues?: GraphQLSearchIssuesNode[],
  ): Promise<GraphQLSearchIssuesNode[]> {
    const projectItemsFieldsGrapQLQuery = this.#projectConfiguration.github.projectFields
      .map((field) => this.getProjectGraphQLFieldQuery(field.alias, field.fieldName, field.type))
      .join('\n');

    const query = `

query getRecentIssues($cursorAfter: String) {
    rateLimit {
      cost
      remaining
      resetAt
    }
   search(query:"repo:${this.#projectConfiguration.github.owner}/${this.#projectConfiguration.github.repo} is:issue sort:updated-asc updated:>${this.#projectConfiguration.github.startDate.toISOString()}", type: ISSUE, first: 50, after: $cursorAfter) {
     pageInfo {
            startCursor
            endCursor
            hasNextPage
          }
       edges {
      node {
        ... on Issue {
          url
          number
          updatedAt
          body
          state
          title
          milestone {
            id
            dueOn
            closed
            title
          }
          labels(first: 20) {
            nodes {
              name
            }
          }
          projectItems(first: 20, includeArchived: true) {
            projects: edges {
              project: node {
                title: project {
                  name: title
                }
                ${projectItemsFieldsGrapQLQuery}
              }
            }
          }          
        }
      }
    }
  }
}
`;

    const graphQlResponse = await graphql<GraphQLSearchIssuesResponse>(query, {
      cursorAfter: cursor,
      headers: {
        authorization: `token ${this.#projectConfiguration.github.readToken}`,
      },
    });

    const currentEntries = graphQlResponse.search.edges.flatMap((edge) => edge.node);

    let allGraphQlResponse: GraphQLSearchIssuesNode[];
    if (previousIssues) {
      allGraphQlResponse = previousIssues.concat(currentEntries);
    } else {
      allGraphQlResponse = currentEntries;
    }

    // how many entries do we have ?
    if (allGraphQlResponse.length >= this.#projectConfiguration.maxBatchNumberIssues) {
      // we have enough entries, need to return only the first _maxBatchNumberIssues
      return allGraphQlResponse.slice(0, this.#projectConfiguration.maxBatchNumberIssues);
    }
    debug(`Fetched additional ${currentEntries.length}, current total ${allGraphQlResponse.length} items`);

    // if there are more issues to fetch, fetch them
    if (graphQlResponse.search.pageInfo.hasNextPage) {
      // needs to redo the search starting from the last search
      debug('Fetching additional issues...');
      return await this.doGetIssuesUpdatedAfterBatch(graphQlResponse.search.pageInfo.endCursor, allGraphQlResponse);
    }

    return allGraphQlResponse;
  }

  getQueryForFieldType(fieldType: ProjectConfigurationFieldType): string {
    if (fieldType === 'number') {
      return `... on ProjectV2ItemFieldNumberValue {
    value: number
  }`;
    }
    if (fieldType === 'singleSelect') {
      return `... on ProjectV2ItemFieldSingleSelectValue {
       name
       }`;
    }

    if (fieldType === 'iteration') {
      return `... on ProjectV2ItemFieldIterationValue {
       duration
       startDate
       title
       }`;
    }
    return '';
  }

  // get graphql query for a field
  getProjectGraphQLFieldQuery(aliasName: string, fieldName: string, fieldType: ProjectConfigurationFieldType): string {
    return `
${aliasName}: fieldValueByName(name: "${fieldName}") {
  ${this.getQueryForFieldType(fieldType)}
}  
`;
  }
}
