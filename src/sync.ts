import { endGroup, startGroup } from '@actions/core';
import type { Configuration } from './config.js';
import { SyncRepository } from './sync-repo.js';

export interface SyncProjectResult {
  // name of the project in sync.yaml
  syncProjectName: string;

  // date to use for the next sync
  afterDate: string;
}
export class Sync {
  #configuration: Configuration;

  constructor(configuration: Configuration) {
    this.#configuration = configuration;
  }

  async start(): Promise<SyncProjectResult[]> {
    // grab project configurations
    const projectConfigurations = this.#configuration.getProjectConfigurations();

    const results: SyncProjectResult[] = [];

    // needs to loop sequentially to each project configuration
    for (const projectConfiguration of projectConfigurations) {
      startGroup(
        `Sync project ${projectConfiguration.name} from ${projectConfiguration.github.owner}/${projectConfiguration.github.repo}`,
      );
      const syncRepository = new SyncRepository(projectConfiguration);
      const projectResult = await syncRepository.start();
      results.push({ syncProjectName: projectConfiguration.name, afterDate: projectResult.afterDate });
      endGroup();
    }

    return results;
  }

  async stop() {}
}
