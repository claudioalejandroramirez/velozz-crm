/**
 * @fileoverview Testes de TagService.
 * Cobertura: aplicação, remoção, expiração e detecção de mudanças.
 */

'use strict';

const { AppConfig } = require('../../src/config/AppConfig');
const { Logger } = require('../../src/utils/Logger');
const { TagService } = require('../../src/services/TagService');
const { TestFactory } = require('../helpers/TestFactory');

describe('TagService', () => {
    let tagService;
    let mockPeople;
    let mockProps;
    let logger;
    let appConfig;

    beforeEach(() => {
        appConfig = TestFactory.appConfig();
        logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };

        // Mock da People API
        mockPeople = {
            ContactGroups: {
                list: jest.fn(() => ({
                    contactGroups: [
                        {
                            name: 'revisar',
                            formattedName: 'revisar',
                            resourceName: 'contactGroups/revisar'
                        },
                        {
                            name: 'novo-telefone',
                            formattedName: 'novo-telefone',
                            resourceName: 'contactGroups/novo-telefone'
                        },
                        {
                            name: 'novo-email',
                            formattedName: 'novo-email',
                            resourceName: 'contactGroups/novo-email'
                        },
                    ],
                })),
                create: jest.fn((payload) => ({
                    resourceName: `contactGroups/${payload.contactGroup.name}`,
                    name: payload.contactGroup.name,
                })),
                Members: {
                    modify: jest.fn(),
                },
            },
        };

        // Mock do PropertiesService com Map em memória
        const store = new Map();
        mockProps = {
            getProperty: jest.fn(k => store.get(k) ?? null),
            setProperty: jest.fn((k, v) => store.set(k, v)),
            deleteProperty: jest.fn(k => store.delete(k)),
            getProperties: jest.fn(() => Object.fromEntries(store)),
            _store: store,
            _reset: () => store.clear(),
        };

        // ContactService mockado
        const mockContactService = {
            aplicarTag: jest.fn(),
            removerTag: jest.fn()
        };

        tagService = new TagService(appConfig, logger, mockContactService, mockProps);
        // Substitui o _contactService interno pelo mock
        tagService._contactService = mockContactService;
    });

    afterEach(() => {
        mockProps._reset();
        jest.clearAllMocks();
    });

    // ═══════════════════════════════════════════════════════════════════════
    // aplicarTagTemporaria()
    // ═══════════════════════════════════════════════════════════════════════
    describe('aplicarTagTemporaria()', () => {

        test('aplica a tag E salva o timer de expiração', () => {
            tagService.aplicarTagTemporaria('people/c123', 'novo-telefone');

            expect(tagService._contactService.aplicarTag).toHaveBeenCalledWith('people/c123', 'novo-telefone');

            const savedKeys = [...mockProps._store.keys()];
            const expiryKey = savedKeys.find(k => k.startsWith('TAG_EXPIRY_'));
            expect(expiryKey).toBeDefined();
        });

        test('timer contém resourceName, tagName e expiry no futuro', () => {
            const before = Date.now();
            tagService.aplicarTagTemporaria('people/c123', 'novo-telefone');
            const after = Date.now();

            const savedKeys = [...mockProps._store.keys()];
            const expiryKey = savedKeys.find(k => k.startsWith('TAG_EXPIRY_'));
            const data = JSON.parse(mockProps._store.get(expiryKey));

            expect(data.resourceName).toBe('people/c123');
            expect(data.tagName).toBe('novo-telefone');
            const expectedExpiry = before + (30 * 24 * 60 * 60 * 1000);
            expect(data.expiry).toBeGreaterThanOrEqual(expectedExpiry - 1000);
            expect(data.expiry).toBeLessThanOrEqual(after + (30 * 24 * 60 * 60 * 1000) + 1000);
        });

        test('falha ao salvar expiração não interrompe fluxo (log warn)', () => {
            mockProps.setProperty.mockImplementationOnce(() => {
                throw new Error('Storage full');
            });

            expect(() => {
                tagService.aplicarTagTemporaria('people/c123', 'novo-telefone');
            }).not.toThrow();

            expect(logger.warn).toHaveBeenCalled();
        });
    });

    // ═══════════════════════════════════════════════════════════════════════
    // limparTagsExpiradas()
    // ═══════════════════════════════════════════════════════════════════════
    describe('limparTagsExpiradas()', () => {

        test('remove tag e chave quando expirada', () => {
            const key = tagService._chaveExpiracao('people/c123', 'novo-telefone');
            mockProps._store.set(key, JSON.stringify({
                resourceName: 'people/c123',
                tagName: 'novo-telefone',
                expiry: Date.now() - 1000,
            }));

            const removed = tagService.limparTagsExpiradas();

            expect(removed).toBe(1);
            expect(tagService._contactService.removerTag).toHaveBeenCalledWith('people/c123', 'novo-telefone');
            expect(mockProps.deleteProperty).toHaveBeenCalledWith(key);
        });

        test('não remove tag com timer ainda ativo', () => {
            const key = tagService._chaveExpiracao('people/c123', 'novo-email');
            mockProps._store.set(key, JSON.stringify({
                resourceName: 'people/c123',
                tagName: 'novo-email',
                expiry: Date.now() + (30 * 24 * 60 * 60 * 1000),
            }));

            const removed = tagService.limparTagsExpiradas();

            expect(removed).toBe(0);
            expect(tagService._contactService.removerTag).not.toHaveBeenCalled();
        });

        test('remove entradas com JSON corrompido (limpeza defensiva)', () => {
            mockProps._store.set('TAG_EXPIRY_corrupted', 'json-invalido-{{{');

            expect(() => tagService.limparTagsExpiradas()).not.toThrow();
            expect(mockProps.deleteProperty).toHaveBeenCalledWith('TAG_EXPIRY_corrupted');
        });

        test('ignora chaves que não são TAG_EXPIRY_*', () => {
            mockProps._store.set('CONTACTS_SYNC_TOKEN', 'token_abc');
            mockProps._store.set('COMPANY_NAME', 'Acme');

            tagService.limparTagsExpiradas();

            expect(mockProps._store.has('CONTACTS_SYNC_TOKEN')).toBe(true);
            expect(mockProps._store.has('COMPANY_NAME')).toBe(true);
        });

        test('retorna 0 quando não há tags expiradas', () => {
            const removed = tagService.limparTagsExpiradas();
            expect(removed).toBe(0);
        });
    });

    // ═══════════════════════════════════════════════════════════════════════
    // Static: phoneChanged() e emailChanged()
    // ═══════════════════════════════════════════════════════════════════════
    describe('TagService.phoneChanged() — static', () => {
        test.each([
            ['11912345678', '(11) 91234-5678', false, 'mesmos dígitos, formatação diferente'],
            ['11912345678', '11999990000', true, 'números diferentes'],
            ['', '11912345678', false, 'planilha vazia — sem mudança'],
            ['11912345678', '', false, 'contacts vazio — sem mudança'],
            ['', '', false, 'ambos vazios'],
        ])('sheet="%s" contacts="%s" → %s (%s)', (sheet, contacts, expected) => {
            expect(TagService.phoneChanged(sheet, contacts)).toBe(expected);
        });
    });

    describe('TagService.emailChanged() — static', () => {
        test.each([
            ['joao@teste.com', 'JOAO@TESTE.COM', false, 'mesmo email, casing diferente'],
            ['joao@teste.com', 'maria@teste.com', true, 'emails diferentes'],
            ['joao@teste.com', ' joao@teste.com', false, 'espaço extra — normalizado'],
            ['', 'joao@teste.com', false, 'planilha vazia'],
            ['joao@teste.com', '', false, 'contacts vazio'],
        ])('sheet="%s" contacts="%s" → %s (%s)', (sheet, contacts, expected) => {
            expect(TagService.emailChanged(sheet, contacts)).toBe(expected);
        });
    });
});