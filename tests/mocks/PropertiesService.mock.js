/**
 * @fileoverview Mock do PropertiesService do GAS.
 * Simula ScriptProperties e UserProperties com um Map em memória.
 */

'use strict';

/**
 * Fábrica de mock de Properties.
 * @returns {Object} Mock com get/set/delete/getProperties
 */
function createPropertiesMock() {
    const store = new Map();
    return {
        getProperty: jest.fn((key) => store.get(key) ?? null),
        setProperty: jest.fn((key, value) => { store.set(key, value); }),
        deleteProperty: jest.fn((key) => { store.delete(key); }),
        getProperties: jest.fn(() => Object.fromEntries(store)),
        setProperties: jest.fn((obj) => {
            Object.keys(obj).forEach(k => store.set(k, obj[k]));
        }),
        // Helper de teste — reseta o store entre testes
        _reset: () => store.clear(),
        _store: store,
    };
}

const scriptProps = createPropertiesMock();
const userProps = createPropertiesMock();
const docProps = createPropertiesMock();

global.PropertiesService = {
    getScriptProperties: jest.fn(() => scriptProps),
    getUserProperties: jest.fn(() => userProps),
    getDocumentProperties: jest.fn(() => docProps),
    // Helpers de teste
    _script: scriptProps,
    _user: userProps,
    _reset: () => {
        scriptProps._reset();
        userProps._reset();
        docProps._reset();
    },
};