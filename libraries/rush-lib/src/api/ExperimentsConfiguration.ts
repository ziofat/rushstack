// Copyright (c) Microsoft Corporation. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

import { JsonFile, JsonSchema, FileSystem } from '@rushstack/node-core-library';

import schemaJson from '../schemas/experiments.schema.json';

/**
 * This interface represents the raw experiments.json file which allows repo
 * maintainers to enable and disable experimental Rush features.
 * @beta
 */
export interface IExperimentsJson {
  /**
   * By default, 'rush install' passes --no-prefer-frozen-lockfile to 'pnpm install'.
   * Set this option to true to pass '--frozen-lockfile' instead.
   */
  usePnpmFrozenLockfileForRushInstall?: boolean;

  /**
   * By default, 'rush update' passes --no-prefer-frozen-lockfile to 'pnpm install'.
   * Set this option to true to pass '--prefer-frozen-lockfile' instead.
   */
  usePnpmPreferFrozenLockfileForRushUpdate?: boolean;

  /**
   * If using the 'preventManualShrinkwrapChanges' option, restricts the hash to only include the layout of external dependencies.
   * Used to allow links between workspace projects or the addition/removal of references to existing dependency versions to not
   * cause hash changes.
   */
  omitImportersFromPreventManualShrinkwrapChanges?: boolean;

  /**
   * If true, the chmod field in temporary project tar headers will not be normalized.
   * This normalization can help ensure consistent tarball integrity across platforms.
   */
  noChmodFieldInTarHeaderNormalization?: boolean;

  /**
   * If true, build caching will respect the allowWarningsInSuccessfulBuild flag and cache builds with warnings.
   * This will not replay warnings from the cached build.
   */
  buildCacheWithAllowWarningsInSuccessfulBuild?: boolean;

  /**
   * If true, the phased commands feature is enabled. To use this feature, create a "phased" command
   * in common/config/rush/command-line.json.
   */
  phasedCommands?: boolean;

  /**
   * If true, perform a clean install after when running `rush install` or `rush update` if the
   * `.npmrc` file has changed since the last install.
   */
  cleanInstallAfterNpmrcChanges?: boolean;

  /**
   * If true, print the outputs of shell commands defined in event hooks to the console.
   */
  printEventHooksOutputToConsole?: boolean;

  /**
   * If true, Rush will not allow node_modules in the repo folder or in parent folders.
   */
  forbidPhantomResolvableNodeModulesFolders?: boolean;
}

/**
 * Use this class to load the "common/config/rush/experiments.json" config file.
 * This file allows repo maintainers to enable and disable experimental Rush features.
 * @public
 */
export class ExperimentsConfiguration {
  private static _jsonSchema: JsonSchema = JsonSchema.fromLoadedObject(schemaJson);

  private _jsonFileName: string;

  /**
   * Get the experiments configuration.
   * @beta
   */
  public readonly configuration: Readonly<IExperimentsJson>;

  /**
   * @internal
   */
  public constructor(jsonFileName: string) {
    this._jsonFileName = jsonFileName;
    this.configuration = {};

    if (!FileSystem.exists(this._jsonFileName)) {
      this.configuration = {};
    } else {
      this.configuration = JsonFile.loadAndValidate(this._jsonFileName, ExperimentsConfiguration._jsonSchema);
    }
  }
}
