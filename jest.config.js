/**
 * @fileoverview Configuração do Jest para o Velozz CRM.
 */

'use strict';

module.exports = {
    testEnvironment: 'node',

    setupFiles: [
        './tests/mocks/GasGlobals.mock.js',
        './tests/mocks/SpreadsheetApp.mock.js',
        './tests/mocks/PeopleAPI.mock.js',
        './tests/mocks/PropertiesService.mock.js',
    ],

    testMatch: ['**/tests/unit/**/*.test.js'],

    collectCoverage: false,
    collectCoverageFrom: [
        'src/**/*.js',
        '!src/triggers/TriggerHandlers.js',
        '!src/ui/**',
    ],
    coverageThreshold: {
        global: {
            branches: 80,
            functions: 80,
            lines: 80,
            statements: 80,
        },
    },
    coverageReporters: ['text', 'lcov', 'html'],

    verbose: true,
    testTimeout: 10000,
};