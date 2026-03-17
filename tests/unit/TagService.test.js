/**
 * @fileoverview Testes de TagService.
 * Cobertura: aplicação, remoção, expiração e detecção de mudanças.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { TestFactory } = require('../helpers/TestFactory');

[
    '../../src/config/AppConfig.js',
    '../../src/utils/Logger.js',
    '../../src/services/TagService.js',
].forEach(f => eval(fs.readFileSync(path.join(__dirname, f), 'utf8')));

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

        tagService = new TagService(appConfig, logger, mockPeople, mockProps);
    });

    afterEach(() => {
        mockProps._reset();
        jest.clearAllMocks();
    });

    // ═══════════════════════════════════════════════════════════════════════
    // apply()
    // ═══════════════════════════════════════════════════════════════════════
    describe('apply()', () => {

        test('chama ContactGroups.Members.modify com resourceNamesToAdd', () => {
            tagService.apply('people/c123', 'revisar');

            expect(mockPeople.ContactGroups.Members.modify).toHaveBeenCalledWith(
                { resourceNamesToAdd: ['people/c123'] },
                'contactGroups/revisar'
            );
        });

        test('usa cache: ContactGroups.list é chamado apenas uma vez', () => {
            tagService.apply('people/c123', 'revisar');
            tagService.apply('people/c123', 'novo-telefone');
            tagService.apply('people/c123', 'novo-email');

            expect(mockPeople.ContactGroups.list).toHaveBeenCalledTimes(1);
        });

        test('cria grupo se não existir e invalida cache', () => {
            tagService.apply('people/c123', 'grupo-novo');

            expect(mockPeople.ContactGroups.create).toHaveBeenCalledWith({
                contactGroup: { name: 'grupo-novo' },
            });
            // Cache foi invalidado após criar o grupo
            expect(tagService._groupCache).toBeNull();
        });

        test('não lança erro se modify falhar (grupo já tem o contato)', () => {
            mockPeople.ContactGroups.Members.modify.mockImplementation(() => {
                throw new Error('Member already in group');
            });

            expect(() => tagService.apply('people/c123', 'revisar')).not.toThrow();
        });
    });

    // ═══════════════════════════════════════════════════════════════════════
    // remove()
    // ═══════════════════════════════════════════════════════════════════════
    describe('remove()', () => {

        test('chama ContactGroups.Members.modify com resourceNamesToRemove', () => {
            tagService.remove('people/c123', 'revisar');

            expect(mockPeople.ContactGroups.Members.modify).toHaveBeenCalledWith(
                { resourceNamesToRemove: ['people/c123'] },
                'contactGroups/revisar'
            );
        });

        test('não faz nada se grupo não existe', () => {
            tagService.remove('people/c123', 'grupo-inexistente');
            expect(mockPeople.ContactGroups.Members.modify).not.toHaveBeenCalled();
        });

        test('não lança erro se contato não estiver no grupo', () => {
            mockPeople.ContactGroups.Members.modify.mockImplementation(() => {
                throw new Error('Member not in group');
            });

            expect(() => tagService.remove('people/c123', 'revisar')).not.toThrow();
        });
    });

    // ═══════════════════════════════════════════════════════════════════════
    // applyTemporary()
    // ═══════════════════════════════════════════════════════════════════════
    describe('applyTemporary()', () => {

        test('aplica a tag E salva o timer de expiração', () => {
            tagService.applyTemporary('people/c123', 'novo-telefone');

            expect(mockPeople.ContactGroups.Members.modify).toHaveBeenCalled();

            // Verifica que o timer foi salvo
            const savedKeys = [...mockProps._store.keys()];
            const expiryKey = savedKeys.find(k => k.startsWith('TAG_EXPIRY_'));
            expect(expiryKey).toBeDefined();
        });

        test('timer contém resourceName, tagName e expiry no futuro', () => {
            const before = Date.now();
            tagService.applyTemporary('people/c123', 'novo-telefone');
            const after = Date.now();

            const savedKeys = [...mockProps._store.keys()];
            const expiryKey = savedKeys.find(k => k.startsWith('TAG_EXPIRY_'));
            const data = JSON.parse(mockProps._store.get(expiryKey));

            expect(data.resourceName).toBe('people/c123');
            expect(data.tagName).toBe('novo-telefone');
            // Expiry deve ser 30 dias no futuro (± margem de 1s para o teste)
            const expectedExpiry = before + (30 * 24 * 60 * 60 * 1000);
            expect(data.expiry).toBeGreaterThanOrEqual(expectedExpiry - 1000);
            expect(data.expiry).toBeLessThanOrEqual(after + (30 * 24 * 60 * 60 * 1000) + 1000);
        });

        test('reaplicar tag reinicia o timer (+30 dias a partir de agora)', () => {
            tagService.applyTemporary('people/c123', 'novo-telefone');

            const savedKeys = [...mockProps._store.keys()];
            const expiryKey = savedKeys.find(k => k.startsWith('TAG_EXPIRY_'));
            const firstExpiry = JSON.parse(mockProps._store.get(expiryKey)).expiry;

            // Simula passagem de tempo e reaplicação
            jest.useFakeTimers();
            jest.advanceTimersByTime(5 * 24 * 60 * 60 * 1000); // +5 dias
            tagService.applyTemporary('people/c123', 'novo-telefone');
            jest.useRealTimers();

            const secondExpiry = JSON.parse(mockProps._store.get(expiryKey)).expiry;
            // Segundo expiry deve ser DEPOIS do primeiro (timer reiniciado)
            expect(secondExpiry).toBeGreaterThan(firstExpiry);
        });
    });

    // ═══════════════════════════════════════════════════════════════════════
    // cleanExpired()
    // ═══════════════════════════════════════════════════════════════════════
    describe('cleanExpired()', () => {

        test('remove tag e chave quando expirada', () => {
            // Insere entrada já expirada (no passado)
            const key = 'TAG_EXPIRY_people_c123_novo_telefone';
            mockProps._store.set(key, JSON.stringify({
                resourceName: 'people/c123',
                tagName: 'novo-telefone',
                expiry: Date.now() - 1000, // 1 segundo no passado
            }));

            const removed = tagService.cleanExpired();

            expect(removed).toBe(1);
            expect(mockPeople.ContactGroups.Members.modify).toHaveBeenCalledWith(
                { resourceNamesToRemove: ['people/c123'] },
                expect.any(String)
            );
            expect(mockProps.deleteProperty).toHaveBeenCalledWith(key);
        });

        test('não remove tag com timer ainda ativo', () => {
            const key = 'TAG_EXPIRY_people_c123_novo_email';
            mockProps._store.set(key, JSON.stringify({
                resourceName: 'people/c123',
                tagName: 'novo-email',
                expiry: Date.now() + (30 * 24 * 60 * 60 * 1000), // 30 dias no futuro
            }));

            const removed = tagService.cleanExpired();

            expect(removed).toBe(0);
            expect(mockPeople.ContactGroups.Members.modify).not.toHaveBeenCalled();
        });

        test('remove entradas com JSON corrompido (limpeza defensiva)', () => {
            mockProps._store.set('TAG_EXPIRY_corrupted', 'json-invalido-{{{');

            expect(() => tagService.cleanExpired()).not.toThrow();
            expect(mockProps.deleteProperty).toHaveBeenCalledWith('TAG_EXPIRY_corrupted');
        });

        test('ignora chaves que não são TAG_EXPIRY_*', () => {
            mockProps._store.set('CONTACTS_SYNC_TOKEN', 'token_abc');
            mockProps._store.set('COMPANY_NAME', 'Acme');

            tagService.cleanExpired();

            // Chaves de configuração não devem ser tocadas
            expect(mockProps._store.has('CONTACTS_SYNC_TOKEN')).toBe(true);
            expect(mockProps._store.has('COMPANY_NAME')).toBe(true);
        });

        test('retorna 0 quando não há tags expiradas', () => {
            const removed = tagService.cleanExpired();
            expect(removed).toBe(0);
        });
    });

    // ═══════════════════════════════════════════════════════════════════════
    // hasActiveTimer()
    // ═══════════════════════════════════════════════════════════════════════
    describe('hasActiveTimer()', () => {

        test('retorna true para tag com timer ativo', () => {
            tagService.applyTemporary('people/c123', 'novo-telefone');
            expect(tagService.hasActiveTimer('people/c123', 'novo-telefone')).toBe(true);
        });

        test('retorna false para tag sem timer', () => {
            expect(tagService.hasActiveTimer('people/c999', 'novo-telefone')).toBe(false);
        });

        test('retorna false para timer expirado', () => {
            const key = tagService._expiryKey('people/c123', 'novo-email');
            mockProps._store.set(key, JSON.stringify({
                resourceName: 'people/c123',
                tagName: 'novo-email',
                expiry: Date.now() - 1000,
            }));

            expect(tagService.hasActiveTimer('people/c123', 'novo-email')).toBe(false);
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