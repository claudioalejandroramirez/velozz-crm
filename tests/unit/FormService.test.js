/**
 * @fileoverview Testes de FormService.
 * Cobertura: extração de dados, validação de evento, payload do contato.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { TestFactory } = require('../helpers/TestFactory');

[
    '../../src/config/AppConfig.js',
    '../../src/utils/Logger.js',
    '../../src/utils/Formatter.js',
    '../../src/validators/DocumentValidator.js',
    '../../src/services/SheetService.js',
    '../../src/services/FormService.js',
].forEach(f => eval(fs.readFileSync(path.join(__dirname, f), 'utf8')));

describe('FormService', () => {
    let formService;
    let appConfig;
    let logger;
    let sheetService;
    let validator;

    beforeEach(() => {
        appConfig = TestFactory.appConfig();
        logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
        sheetService = new SheetService(appConfig, logger);
        validator = new DocumentValidator();
        formService = new FormService(
            appConfig, logger, sheetService, validator, Formatter
        );
    });

    afterEach(() => jest.clearAllMocks());

    // ═══════════════════════════════════════════════════════════════════════
    // extractFormData() — PF
    // ═══════════════════════════════════════════════════════════════════════
    describe('extractFormData() — PF', () => {

        test('extrai todos os campos corretamente de namedValues', () => {
            const event = TestFactory.formEventPF();
            const data = formService.extractFormData(event, 'PF');

            expect(data.tipo).toBe('PF');
            expect(data.isPF).toBe(true);
            expect(data.nome).toBe('João');
            expect(data.sobrenome).toBe('Silva');
            expect(data.documentoLimpo).toBe('52998224725');
            expect(data.docTipo).toBe('CPF');
            expect(data.telefoneLimpo).toBe('11912345678');
            expect(data.email).toBe('joao@teste.com');
            expect(data.isValid).toBe(true);
        });

        test('limpa máscara do CPF durante extração', () => {
            const event = TestFactory.formEventPF({ 'CPF': ['529.982.247-25'] });
            const data = formService.extractFormData(event, 'PF');
            expect(data.documentoLimpo).toBe('52998224725');
        });

        test('isValid=false para CPF inválido', () => {
            const event = TestFactory.formEventPF({ 'CPF': ['12345678900'] });
            const data = formService.extractFormData(event, 'PF');
            expect(data.isValid).toBe(false);
        });

        test('CPF começando com zero: preserva zero na extração', () => {
            const event = TestFactory.formEventPF({ 'CPF': ['01234567890'] });
            const data = formService.extractFormData(event, 'PF');
            expect(data.documentoLimpo).toBe('01234567890');
            expect(data.documentoLimpo.length).toBe(11);
            expect(data.documentoLimpo[0]).toBe('0');
        });

        test('campos vazios não causam erro', () => {
            const event = TestFactory.formEventPF({
                'Complemento': [''],
                'Telefone': [''],
            });
            expect(() => formService.extractFormData(event, 'PF')).not.toThrow();
        });
    });

    // ═══════════════════════════════════════════════════════════════════════
    // extractFormData() — PJ
    // ═══════════════════════════════════════════════════════════════════════
    describe('extractFormData() — PJ', () => {

        test('extrai campos específicos de PJ corretamente', () => {
            const event = TestFactory.formEventPJ();
            const data = formService.extractFormData(event, 'PJ');

            expect(data.tipo).toBe('PJ');
            expect(data.isPF).toBe(false);
            expect(data.empresa).toBe('Acme Ltda');
            expect(data.documentoLimpo).toBe('11222333000181');
            expect(data.docTipo).toBe('CNPJ');
            expect(data.isValid).toBe(true);
        });

        test('sobrenome é vazio para PJ', () => {
            const event = TestFactory.formEventPJ();
            const data = formService.extractFormData(event, 'PJ');
            expect(data.sobrenome).toBe('');
        });
    });

    // ═══════════════════════════════════════════════════════════════════════
    // validateFormEvent()
    // ═══════════════════════════════════════════════════════════════════════
    describe('validateFormEvent()', () => {

        test('retorna valid=true para evento completo de PF', () => {
            const event = TestFactory.formEventPF();
            const result = formService.validateFormEvent(event, 'PF');
            expect(result.valid).toBe(true);
            expect(result.missingKeys).toHaveLength(0);
        });

        test('retorna valid=false e lista chaves ausentes', () => {
            const event = { namedValues: { 'Data': ['16/03/2026'] } }; // incompleto
            const result = formService.validateFormEvent(event, 'PF');

            expect(result.valid).toBe(false);
            expect(result.missingKeys).toContain('Nome');
            expect(result.missingKeys).toContain('CPF');
        });

        test('loga aviso quando há campos ausentes', () => {
            const event = { namedValues: {} };
            formService.validateFormEvent(event, 'PF');
            expect(logger.warn).toHaveBeenCalledWith(
                'FormService.validateFormEvent',
                expect.stringContaining('campos ausentes')
            );
        });

        test('cliente renomeou pergunta no Forms: detecta o campo ausente', () => {
            // Simula cliente que renomeou "CPF" para "Número do CPF" no Forms
            // sem atualizar a configuração COL_DOC_PF
            const event = TestFactory.formEventPF();
            delete event.namedValues['CPF']; // Remove o campo esperado
            event.namedValues['Número do CPF'] = ['529.982.247-25']; // Nome novo

            const result = formService.validateFormEvent(event, 'PF');
            // Deve detectar que 'CPF' está faltando e sugerir verificar configuração
            expect(result.valid).toBe(false);
            expect(result.missingKeys).toContain('CPF');
        });
    });

    // ═══════════════════════════════════════════════════════════════════════
    // buildContactPayload()
    // ═══════════════════════════════════════════════════════════════════════
    describe('buildContactPayload()', () => {

        test('constrói payload completo para PF válido', () => {
            const dados = TestFactory.validPF();
            const payload = formService.buildContactPayload(dados);

            expect(payload.names[0].givenName).toBe('João');
            expect(payload.names[0].familyName).toBe('Silva');
            expect(payload.emailAddresses[0].value).toBe('joao@teste.com');
            expect(payload.phoneNumbers[0].value).toBe('(11) 91234-5678');
            expect(payload.biographies[0].value).toBe('CPF: 529.982.247-25');
            expect(payload.addresses[0].streetAddress).toContain('Rua das Flores');
        });

        test('biography marcada como [INVÁLIDO] para DOC inválido', () => {
            const dados = TestFactory.invalidDocPF();
            const payload = formService.buildContactPayload(dados);
            expect(payload.biographies[0].value).toContain('[INVÁLIDO]');
        });

        test('não inclui emailAddresses se email vazio', () => {
            const dados = TestFactory.validPF({ email: '' });
            const payload = formService.buildContactPayload(dados);
            expect(payload.emailAddresses).toBeUndefined();
        });

        test('não inclui phoneNumbers se telefone vazio', () => {
            const dados = TestFactory.validPF({ telefoneLimpo: '' });
            const payload = formService.buildContactPayload(dados);
            expect(payload.phoneNumbers).toBeUndefined();
        });

        test('inclui organizations para PJ', () => {
            const dados = TestFactory.validPJ();
            const payload = formService.buildContactPayload(dados);
            expect(payload.organizations[0].name).toBe('Acme Ltda');
        });

        test('não inclui organizations para PF', () => {
            const dados = TestFactory.validPF();
            const payload = formService.buildContactPayload(dados);
            expect(payload.organizations).toBeUndefined();
        });

        test('endereço com complemento é concatenado corretamente', () => {
            const dados = TestFactory.validPF({
                logradouro: 'Rua das Flores',
                numero: '123',
                complemento: 'Apto 4',
            });
            const payload = formService.buildContactPayload(dados);
            expect(payload.addresses[0].streetAddress)
                .toBe('Rua das Flores, 123 - Apto 4');
        });

        test('endereço sem complemento não inclui " - "', () => {
            const dados = TestFactory.validPF({
                logradouro: 'Rua das Flores',
                numero: '123',
                complemento: '',
            });
            const payload = formService.buildContactPayload(dados);
            expect(payload.addresses[0].streetAddress).toBe('Rua das Flores, 123');
            expect(payload.addresses[0].streetAddress).not.toContain(' - ');
        });

        test('não inclui addresses se logradouro e numero vazios', () => {
            const dados = TestFactory.validPF({
                logradouro: '',
                numero: '',
                complemento: '',
            });
            const payload = formService.buildContactPayload(dados);
            expect(payload.addresses).toBeUndefined();
        });

        test('telefone formatado corretamente no payload', () => {
            const dados = TestFactory.validPF({ telefoneLimpo: '1133334444' });
            const payload = formService.buildContactPayload(dados);
            expect(payload.phoneNumbers[0].value).toBe('(11) 3333-4444');
        });
    });
});