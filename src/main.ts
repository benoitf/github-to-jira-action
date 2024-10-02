import * as core from '@actions/core';

import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import * as jsYaml from 'js-yaml';
import { Configuration } from './config.js';
import type { SyncStateYaml, SyncYaml } from './sync-yaml-config-file.js';
import { Sync } from './sync.js';

export class Main {
  public static readonly JIRA_HOST: string = 'jira-host';
  public static readonly JIRA_WRITE_TOKEN: string = 'jira-write-token';
  public static readonly GITHUB_READ_TOKEN: string = 'github-read-token';

  #sync: Sync | undefined;

  protected async doStart(): Promise<void> {
    // Jira host
    const jiraHost = core.getInput(Main.JIRA_HOST);
    if (!jiraHost) {
      throw new Error('No Jira Host provided');
    }

    // Jira write token
    const jiraWriteToken = core.getInput(Main.JIRA_WRITE_TOKEN);
    if (!jiraWriteToken) {
      throw new Error('No Jira Write Token provided');
    }

    // github write token
    const githubReadToken = core.getInput(Main.GITHUB_READ_TOKEN);
    if (!githubReadToken) {
      throw new Error('No GitHub Read Token provided');
    }

    // read the yaml file sync.yaml
    const content = await readFile('sync.yaml', 'utf8');

    // use yaml to parse the content
    const syncYaml = jsYaml.load(content) as SyncYaml;

    // do we have a state file ?
    let syncStateYaml: SyncStateYaml | undefined = undefined;
    if (existsSync('sync-state.yaml')) {
      // read the yaml file sync-state.yaml
      const stateContent = await readFile('sync-state.yaml', 'utf8');

      // use yaml to parse the content
      syncStateYaml = jsYaml.load(stateContent) as SyncStateYaml;
    }

    const params = {
      githubReadToken,
      jiraHost,
      jiraWriteToken,
      syncYaml,
      syncStateYaml,
    };

    const configuration = new Configuration(params);
    configuration.init();

    this.#sync = new Sync(configuration);
    const syncResult = await this.#sync.start();

    // write the result to the output
    core.setOutput('sync-projects-result', syncResult);

    const syncStateYamlToWrite: SyncStateYaml = {
      syncProjects: syncResult,
    };

    // also write the content to a file
    const fileContent = jsYaml.dump(syncStateYamlToWrite, { noArrayIndent: true, quotingType: '"', lineWidth: -1 });
    await writeFile('sync-state.yaml', fileContent, 'utf8');
  }

  async doStop(): Promise<void> {
    await this.#sync?.stop();
  }

  async start(): Promise<boolean> {
    try {
      await this.doStart();
      return true;
    } catch (error: unknown) {
      console.error(error);
      core.setFailed(String(error));
      return false;
    } finally {
      await this.doStop();
    }
  }
}
