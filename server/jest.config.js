const { pathsToModuleNameMapper } = require('ts-jest/utils');
const { compilerOptions } = require('./tsconfig.json');

module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  transform: {
    '^.+\\.tsx?$': 'ts-jest',
  },
  moduleNameMapper: {
    // jest 27 does not resolve package.json "exports" subpaths
    '^@tribeplatform/slate-kit/convertors$': '<rootDir>/node_modules/@tribeplatform/slate-kit/dist/cjs/convertors/index.js',
    ...pathsToModuleNameMapper(compilerOptions.paths, { prefix: '<rootDir>/src' }),
  },
};
