// Copyright (c) Microsoft Corporation. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.
/// <reference lib="dom" />

import * as path from 'path';
import { URL, pathToFileURL, fileURLToPath } from 'url';
import { CompileResult, Syntax, Exception, compileStringAsync } from 'sass-embedded';
import * as postcss from 'postcss';
import cssModules from 'postcss-modules';
import { FileSystem, Sort } from '@rushstack/node-core-library';
import { IStringValueTypings, StringValuesTypingsGenerator } from '@rushstack/typings-generator';

/**
 * @public
 */
export interface ISassConfiguration {
  /**
   * Source code root directory.
   * Defaults to "src/".
   */
  srcFolder?: string;

  /**
   * Output directory for generated Sass typings.
   * Defaults to "temp/sass-ts/".
   */
  generatedTsFolder?: string;

  /**
   * Optional additional folders to which Sass typings should be output.
   */
  secondaryGeneratedTsFolders?: string[];

  /**
   * Output directories for compiled CSS
   */
  cssOutputFolders?: string[] | undefined;

  /**
   * If `true`, when emitting compiled CSS from a file with a ".scss" extension, the emitted CSS will have the extension ".scss" instead of ".scss.css"
   */
  preserveSCSSExtension?: boolean | undefined;

  /**
   * Determines whether export values are wrapped in a default property, or not.
   * Defaults to true.
   */
  exportAsDefault?: boolean;

  /**
   * Files with these extensions will pass through the Sass transpiler for typings generation.
   * They will be treated as SCSS modules.
   * Defaults to [".sass", ".scss", ".css"]
   */
  fileExtensions?: string[];

  /**
   * Files with these extensions will pass through the Sass transpiler for typings generation.
   * They will be treated as non-module SCSS.
   * Defaults to [".global.sass", ".global.scss", ".global.css"]
   */
  nonModuleFileExtensions?: string[];

  /**
   * A list of paths used when resolving Sass `@imports` and `@use`.
   * The paths should be relative to the project root.
   * Defaults to ["node_modules", "src"]
   */
  importIncludePaths?: string[];

  /**
   * A list of file paths relative to the "src" folder that should be excluded from typings generation.
   */
  excludeFiles?: string[];
}

/**
 * @public
 */
export interface ISassTypingsGeneratorOptions {
  buildFolder: string;
  sassConfiguration: ISassConfiguration;
}

interface IClassMap {
  [className: string]: string;
}

/**
 * Generates type files (.d.ts) for Sass/SCSS/CSS files and optionally produces CSS files.
 *
 * @public
 */
export class SassProcessor extends StringValuesTypingsGenerator {
  /**
   * @param buildFolder - The project folder to search for Sass files and
   *     generate typings.
   */
  public constructor(options: ISassTypingsGeneratorOptions) {
    const { buildFolder, sassConfiguration } = options;
    const srcFolder: string = sassConfiguration.srcFolder || `${buildFolder}/src`;
    const generatedTsFolder: string = sassConfiguration.generatedTsFolder || `${buildFolder}/temp/sass-ts`;
    const exportAsDefault: boolean =
      sassConfiguration.exportAsDefault === undefined ? true : sassConfiguration.exportAsDefault;
    const exportAsDefaultInterfaceName: string = 'IExportStyles';

    const { allFileExtensions, isFileModule } = buildExtensionClassifier(sassConfiguration);

    const { cssOutputFolders, preserveSCSSExtension = false } = sassConfiguration;

    const getCssPaths: ((relativePath: string) => string[]) | undefined = cssOutputFolders
      ? (relativePath: string): string[] => {
          const lastDot: number = relativePath.lastIndexOf('.');
          const oldExtension: string = relativePath.slice(lastDot);
          const cssRelativePath: string =
            oldExtension === '.css' || (oldExtension === '.scss' && preserveSCSSExtension)
              ? relativePath
              : `${relativePath}.css`;

          const cssPaths: string[] = [];
          for (const outputFolder of cssOutputFolders) {
            cssPaths.push(`${outputFolder}/${cssRelativePath}`);
          }
          return cssPaths;
        }
      : undefined;

    super({
      srcFolder,
      generatedTsFolder,
      exportAsDefault,
      exportAsDefaultInterfaceName,
      fileExtensions: allFileExtensions,
      filesToIgnore: sassConfiguration.excludeFiles,
      secondaryGeneratedTsFolders: sassConfiguration.secondaryGeneratedTsFolders,

      getAdditionalOutputFiles: getCssPaths,

      // Generate typings function
      parseAndGenerateTypings: async (fileContents: string, filePath: string, relativePath: string) => {
        if (this._isSassPartial(filePath)) {
          // Do not generate typings for Sass partials.
          return;
        }

        const isModule: boolean = isFileModule(relativePath);

        const css: string = await this._transpileSassAsync(
          fileContents,
          filePath,
          buildFolder,
          sassConfiguration.importIncludePaths
        );

        let classMap: IClassMap = {};

        if (isModule) {
          // Not all input files are SCSS modules
          const cssModulesClassMapPlugin: postcss.Plugin = cssModules({
            getJSON: (cssFileName: string, json: IClassMap) => {
              // This callback will be invoked during the promise evaluation of the postcss process() function.
              classMap = json;
            },
            // Avoid unnecessary name hashing.
            generateScopedName: (name: string) => name
          });

          await postcss.default([cssModulesClassMapPlugin]).process(css, { from: filePath });
        }

        if (getCssPaths) {
          await Promise.all(
            getCssPaths(relativePath).map(async (cssFile: string) => {
              // The typings generator processes files serially and the number of output folders is expected to be small,
              // thus throttling here is not currently a concern.
              await FileSystem.writeFileAsync(cssFile, css, {
                ensureFolderExists: true
              });
            })
          );
        }

        const sortedClassNames: string[] = Object.keys(classMap).sort();

        const sassTypings: IStringValueTypings = {
          typings: sortedClassNames.map((exportName: string) => {
            return {
              exportName
            };
          })
        };

        return sassTypings;
      }
    });
  }

  /**
   * Sass partial files are snippets of CSS meant to be included in other Sass files.
   * Partial filenames always begin with a leading underscore and do not produce a CSS output file.
   */
  private _isSassPartial(filePath: string): boolean {
    return path.basename(filePath)[0] === '_';
  }

  private async _transpileSassAsync(
    fileContents: string,
    filePath: string,
    buildFolder: string,
    importIncludePaths: string[] | undefined
  ): Promise<string> {
    let result: CompileResult;
    const nodeModulesUrl: URL = pathToFileURL(`${buildFolder}/node_modules/`);
    try {
      result = await compileStringAsync(fileContents, {
        importers: [
          {
            findFileUrl: (url: string): URL | null => {
              return this._patchSassUrl(url, nodeModulesUrl);
            }
          }
        ],
        url: pathToFileURL(filePath),
        loadPaths: importIncludePaths
          ? importIncludePaths
          : [`${buildFolder}/node_modules`, `${buildFolder}/src`],
        syntax: determineSyntaxFromFilePath(filePath)
      });
    } catch (err) {
      const typedError: Exception = err;
      const { span } = typedError;

      // Extract location information and format into the error message until we have a concept
      // of location-aware diagnostics in Heft.
      throw new Error(`${typedError}(${span.start.column},${span.start.line}): ${typedError.message}`);
    }

    // Register any @import, @use files as dependencies.
    for (const dependency of result.loadedUrls) {
      this.registerDependency(filePath, fileURLToPath(dependency as URL));
    }

    return result.css.toString();
  }

  private _patchSassUrl(url: string, nodeModulesUrl: URL): URL | null {
    if (url[0] !== '~') {
      return null;
    }

    return new URL(url.slice(1), nodeModulesUrl);
  }
}

interface IExtensionClassifierResult {
  allFileExtensions: string[];
  isFileModule: (relativePath: string) => boolean;
}

function buildExtensionClassifier(sassConfiguration: ISassConfiguration): IExtensionClassifierResult {
  const {
    fileExtensions: moduleFileExtensions = ['.sass', '.scss', '.css'],
    nonModuleFileExtensions = ['.global.sass', '.global.scss', '.global.css']
  } = sassConfiguration;

  const hasModules: boolean = moduleFileExtensions.length > 0;
  const hasNonModules: boolean = nonModuleFileExtensions.length > 0;

  if (!hasModules) {
    return {
      allFileExtensions: nonModuleFileExtensions,
      isFileModule: (relativePath: string) => false
    };
  }
  if (!hasNonModules) {
    return {
      allFileExtensions: moduleFileExtensions,
      isFileModule: (relativePath: string) => true
    };
  }

  const extensionClassifier: Map<string, boolean> = new Map();
  for (const extension of moduleFileExtensions) {
    const normalizedExtension: string = extension.startsWith('.') ? extension : `.${extension}`;
    extensionClassifier.set(normalizedExtension, true);
  }

  for (const extension of nonModuleFileExtensions) {
    const normalizedExtension: string = extension.startsWith('.') ? extension : `.${extension}`;
    const existingClassification: boolean | undefined = extensionClassifier.get(normalizedExtension);
    if (existingClassification === true) {
      throw new Error(
        `File extension "${normalizedExtension}" is declared as both a SCSS module and not an SCSS module.`
      );
    }
    extensionClassifier.set(normalizedExtension, false);
  }

  Sort.sortMapKeys(extensionClassifier, (key1, key2) => {
    // Order by length, descending, so the longest gets tested first.
    return key2.length - key1.length;
  });

  const isFileModule: (relativePath: string) => boolean = (relativePath: string) => {
    // Naive comparison algorithm. O(E), where E is the number of extensions
    // If performance becomes an issue, switch to using LookupByPath with a reverse iteration order using `.` as the delimiter
    for (const [extension, isExtensionModule] of extensionClassifier) {
      if (relativePath.endsWith(extension)) {
        return isExtensionModule;
      }
    }
    throw new Error(`Could not classify ${relativePath} as a SCSS module / not an SCSS module`);
  };

  return {
    allFileExtensions: [...extensionClassifier.keys()],
    isFileModule
  };
}

function determineSyntaxFromFilePath(path: string): Syntax {
  switch (path.substring(path.lastIndexOf('.'))) {
    case '.sass':
      return 'indented';
    case '.scss':
      return 'scss';
    default:
      return 'css';
  }
}
