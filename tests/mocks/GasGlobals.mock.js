/**
 * @fileoverview Mock dos globais do GAS que não são serviços específicos.
 * Carregado antes de qualquer suite de teste.
 *
 * ⚠️ Este arquivo declara globais em process para que os arquivos src/
 * possam ser carregados pelo Jest sem lançar ReferenceError.
 */

'use strict';

// ── Session ───────────────────────────────────────────────────────────────
global.Session = {
    getEffectiveUser: () => ({ getEmail: () => 'test@velozz.com' }),
};

// ── MailApp ───────────────────────────────────────────────────────────────
global.MailApp = {
    sendEmail: jest.fn(),
};

// ── LockService ───────────────────────────────────────────────────────────
global.LockService = {
    getScriptLock: () => ({
        tryLock: jest.fn().mockReturnValue(true),
        releaseLock: jest.fn(),
    }),
};

// ── ScriptApp ─────────────────────────────────────────────────────────────
global.ScriptApp = {
    getProjectTriggers: jest.fn().mockReturnValue([]),
    newTrigger: jest.fn().mockReturnValue({
        timeBased: jest.fn().mockReturnThis(),
        everyDays: jest.fn().mockReturnThis(),
        atHour: jest.fn().mockReturnThis(),
        create: jest.fn(),
    }),
};

// ── HtmlService ───────────────────────────────────────────────────────────
global.HtmlService = {
    createHtmlOutputFromFile: jest.fn().mockReturnValue({
        setTitle: jest.fn().mockReturnThis(),
        setWidth: jest.fn().mockReturnThis(),
        setHeight: jest.fn().mockReturnThis(),
    }),
};

// ── Utilities ─────────────────────────────────────────────────────────────
global.Utilities = {
    sleep: jest.fn(),
    formatDate: jest.fn((date) => date.toISOString()),
};

// ── Console (já existe no Node mas reexporta para consistência) ───────────
global.console = global.console || {
    log: () => { },
    error: () => { },
    warn: () => { },
};