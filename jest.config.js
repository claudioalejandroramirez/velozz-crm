/**
 * @fileoverview Configuração do Jest para o Velozz CRM.
 *
 * ⚠️ GAS RUNTIME: o Jest roda em Node.js, não no GAS V8.
 * Todos os objetos globais do GAS (SpreadsheetApp, People, etc.)
 * são mockados via setupFiles antes de cada suite de testes.
 */

'use strict';

module.exports = {
    // Ambiente Node puro — sem DOM (o GAS não tem DOM)
    testEnvironment: 'node',

    // Mocks globais carregados antes de cada suite
    setupFiles: [
        './tests/mocks/GasGlobals.mock.js',
        './tests/mocks/SpreadsheetApp.mock.js',
        './tests/mocks/PeopleAPI.mock.js',
        './tests/mocks/PropertiesService.mock.js',
    ],

    // Onde estão os testes
    testMatch: ['**/tests/unit/**/*.test.js'],

    // Cobertura
    collectCoverage: false, // Ativado via --coverage na CLI
    collectCoverageFrom: [
        'src/**/*.js',
        // TriggerHandlers é cola de boilerplate GAS — difícil de testar unitariamente
        '!src/triggers/TriggerHandlers.js',
        // HTML não é testado pelo Jest
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

    // Verbose para CI — mostra cada teste individualmente
    verbose: true,

    // Timeout generoso para operações que simulam chamadas à API
    testTimeout: 10000,
};