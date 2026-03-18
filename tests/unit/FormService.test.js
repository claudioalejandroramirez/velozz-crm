/**
 * @fileoverview Testes de FormService.
 * Cobertura: extração de dados, validação de evento, payload do contato.
 */

'use strict';

const { AppConfig } = require('../../src/config/AppConfig');
const { Logger } = require('../../src/utils/Logger');
const { Formatter } = require('../../src/utils/Formatter');
const { DocumentValidator } = require('../../src/validators/DocumentValidator');
const { SheetService } = require('../../src/services/SheetService');
const { FormService } = require('../../src/services/FormService');
const { TestFactory } = require('../helpers/TestFactory');

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
        formService = new FormService(validator, Formatter);
    });

    afterEach(() => jest.clearAllMocks());

    // ═══════════════════════════════════════════════════════════════════════
    // extrairDadosFormulario() — PF (via e.values)
    // ═══════════════════════════════════════════════════════════════════════
    describe('extrairDadosFormulario() — PF', () => {

        test('extrai todos os campos corretamente de e.values (PF)', () => {
            const values = [
                '16/03/2026', 'Pessoa Física', 'João', 'Silva',
                '529.982.247-25', 'Rua das Flores', '123', 'Apto 4',
                '(11) 91234-5678', 'joao@teste.com'
            ];
            const data = formService.extrairDadosFormulario(values, 'Pessoa Física');

            expect(data.tipo).toBe('Pessoa Física');
            expect(data.nome).toBe('João');
            expect(data.sobrenome).toBe('Silva');
            expect(data.documentoLimpo).toBe('52998224725');
            expect(data.docTipo).toBe('CPF');
            expect(data.telefoneLimpo).toBe('11912345678');
            expect(data.email).toBe('joao@teste.com');
            expect(data.isValid).toBe(true);
            expect(data.empresa).toBe('');
        });

        test('limpa máscara do CPF durante extração', () => {
            const values = [
                '16/03/2026', 'Pessoa Física', 'João', 'Silva',
                '529.982.247-25', '', '', '', '', ''
            ];
            const data = formService.extrairDadosFormulario(values, 'Pessoa Física');
            expect(data.documentoLimpo).toBe('52998224725');
        });

        test('isValid=false para CPF inválido', () => {
            const values = [
                '16/03/2026', 'Pessoa Física', 'João', 'Silva',
                '12345678900', '', '', '', '', ''
            ];
            const data = formService.extrairDadosFormulario(values, 'Pessoa Física');
            expect(data.isValid).toBe(false);
        });

        test('CPF começando com zero: preserva zero na extração', () => {
            const values = [
                '16/03/2026', 'Pessoa Física', 'João', 'Silva',
                '01234567890', '', '', '', '', ''
            ];
            const data = formService.extrairDadosFormulario(values, 'Pessoa Física');
            expect(data.documentoLimpo).toBe('01234567890');
            expect(data.documentoLimpo.length).toBe(11);
            expect(data.documentoLimpo[0]).toBe('0');
        });

        test('campos vazios não causam erro', () => {
            const values = [
                '16/03/2026', 'Pessoa Física', 'João', 'Silva',
                '', '', '', '', '', ''
            ];
            expect(() => formService.extrairDadosFormulario(values, 'Pessoa Física')).not.toThrow();
        });

        test('acesso defensivo: valores faltantes retornam string vazia', () => {
            const values = ['16/03/2026', 'Pessoa Física']; // array menor que o esperado
            const data = formService.extrairDadosFormulario(values, 'Pessoa Física');
            expect(data.nome).toBe('');
            expect(data.documentoLimpo).toBe('');
        });
    });

    // ═══════════════════════════════════════════════════════════════════════
    // extrairDadosFormulario() — PJ (via e.values)
    // ═══════════════════════════════════════════════════════════════════════
    describe('extrairDadosFormulario() — PJ', () => {

        test('extrai campos específicos de PJ corretamente', () => {
            const values = [
                '16/03/2026', 'Pessoa Jurídica',  // índices 0,1
                '', '', '', '', '', '', '', '',  // índices 2-9 (PF) vazios
                'Maria', 'Silva', 'Acme Ltda',   // índices 10,11,12
                '11.222.333/0001-81',             // índice 13
                'Av. Paulista', '1000', 'Sala 5', // índices 14,15,16
                '(11) 3333-4444', 'contato@acme.com' // índices 17,18
            ];
            const data = formService.extrairDadosFormulario(values, 'Pessoa Jurídica');

            expect(data.tipo).toBe('Pessoa Jurídica');
            expect(data.nome).toBe('Maria');
            expect(data.sobrenome).toBe('Silva');
            expect(data.empresa).toBe('Acme Ltda');
            expect(data.documentoLimpo).toBe('11222333000181');
            expect(data.docTipo).toBe('CNPJ');
            expect(data.isValid).toBe(true);
        });

        test('sobrenome é opcional para PJ', () => {
            const values = [
                '16/03/2026', 'Pessoa Jurídica',
                '', '', '', '', '', '', '', '',
                'Maria', '', 'Acme Ltda',  // sobrenome vazio
                '11.222.333/0001-81',
                'Av. Paulista', '1000', 'Sala 5',
                '(11) 3333-4444', 'contato@acme.com'
            ];
            const data = formService.extrairDadosFormulario(values, 'Pessoa Jurídica');
            expect(data.sobrenome).toBe('');
        });

        test('campos PF chegam vazios para PJ e não quebram', () => {
            const values = [
                '16/03/2026', 'Pessoa Jurídica',
                '', '', '', '', '', '', '', '', // PF vazios
                'Maria', '', 'Acme Ltda',
                '11.222.333/0001-81',
                'Av. Paulista', '1000', 'Sala 5',
                '(11) 3333-4444', 'contato@acme.com'
            ];
            const data = formService.extrairDadosFormulario(values, 'Pessoa Jurídica');
            expect(data.nome).toBe('Maria'); // Nome Responsável
            expect(data.sobrenome).toBe(''); // Sobrenome pode ser vazio
        });

        test('tipo desconhecido ainda extrai dados mas não valida', () => {
            const values = [
                '16/03/2026', 'Tipo Desconhecido',
                '', '', '', '', '', '', '', '',
                'Maria', '', 'Acme Ltda',
                '11.222.333/0001-81',
                'Av. Paulista', '1000', 'Sala 5',
                '(11) 3333-4444', 'contato@acme.com'
            ];
            // A validação do tipo é feita no trigger, não no FormService
            // FormService apenas extrai o que recebe
            const data = formService.extrairDadosFormulario(values, 'Tipo Desconhecido');
            expect(data.tipo).toBe('Tipo Desconhecido');
        });
    });

    // ═══════════════════════════════════════════════════════════════════════
    // montarObjetoPessoa()
    // ═══════════════════════════════════════════════════════════════════════
    describe('montarObjetoPessoa()', () => {

        test('constrói payload completo para PF válido', () => {
            const dados = TestFactory.validPF();
            const payload = formService.montarObjetoPessoa(dados);

            expect(payload.names[0].givenName).toBe('João');
            expect(payload.names[0].familyName).toBe('Silva');
            expect(payload.emailAddresses[0].value).toBe('joao@teste.com');
            expect(payload.phoneNumbers[0].value).toBe('(11) 91234-5678');
            expect(payload.biographies[0].value).toBe('CPF: 529.982.247-25');
            expect(payload.addresses[0].streetAddress).toBe('Rua das Flores, 123 - Apto 4');
        });

        test('biography marcada como [INVÁLIDO] para DOC inválido', () => {
            const dados = TestFactory.invalidDocPF();
            const payload = formService.montarObjetoPessoa(dados);
            expect(payload.biographies[0].value).toBe('CPF: 12345678900 [INVÁLIDO]');
        });

        test('não inclui emailAddresses se email vazio', () => {
            const dados = TestFactory.validPF({ email: '' });
            const payload = formService.montarObjetoPessoa(dados);
            expect(payload.emailAddresses).toBeUndefined();
        });

        test('não inclui phoneNumbers se telefone vazio', () => {
            const dados = TestFactory.validPF({ telefoneLimpo: '' });
            const payload = formService.montarObjetoPessoa(dados);
            expect(payload.phoneNumbers).toBeUndefined();
        });

        test('inclui organizations para PJ', () => {
            const dados = TestFactory.validPJ();
            const payload = formService.montarObjetoPessoa(dados);
            expect(payload.organizations[0].name).toBe('Acme Ltda');
        });

        test('não inclui organizations para PF', () => {
            const dados = TestFactory.validPF();
            const payload = formService.montarObjetoPessoa(dados);
            expect(payload.organizations).toBeUndefined();
        });

        test('endereço com complemento é concatenado corretamente', () => {
            const dados = TestFactory.validPF({
                logradouro: 'Rua das Flores',
                numero: '123',
                complemento: 'Apto 4',
            });
            const payload = formService.montarObjetoPessoa(dados);
            expect(payload.addresses[0].streetAddress).toBe('Rua das Flores, 123 - Apto 4');
        });

        test('endereço sem complemento não inclui " - "', () => {
            const dados = TestFactory.validPF({
                logradouro: 'Rua das Flores',
                numero: '123',
                complemento: '',
            });
            const payload = formService.montarObjetoPessoa(dados);
            expect(payload.addresses[0].streetAddress).toBe('Rua das Flores, 123');
        });

        test('não inclui addresses se logradouro e numero vazios', () => {
            const dados = TestFactory.validPF({
                logradouro: '',
                numero: '',
                complemento: '',
            });
            const payload = formService.montarObjetoPessoa(dados);
            expect(payload.addresses).toBeUndefined();
        });

        test('telefone de 8 dígitos retorna raw sem formatação', () => {
            const dados = TestFactory.validPF({ telefoneLimpo: '12345678' });
            const payload = formService.montarObjetoPessoa(dados);
            expect(payload.phoneNumbers[0].value).toBe('12345678');
        });

        test('telefone de 10 dígitos formatado como fixo', () => {
            const dados = TestFactory.validPF({ telefoneLimpo: '1133334444' });
            const payload = formService.montarObjetoPessoa(dados);
            expect(payload.phoneNumbers[0].value).toBe('(11) 3333-4444');
        });

        test('telefone de 11 dígitos formatado como celular', () => {
            const dados = TestFactory.validPF({ telefoneLimpo: '11912345678' });
            const payload = formService.montarObjetoPessoa(dados);
            expect(payload.phoneNumbers[0].value).toBe('(11) 91234-5678');
        });
    });
});