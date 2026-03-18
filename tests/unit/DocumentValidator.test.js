/**
 * @fileoverview Testes de DocumentValidator.
 * Cobertura: validação CPF/CNPJ, identificação automática,
 * detecção de correção do operador e edge cases.
 */

'use strict';

const { DocumentValidator } = require('../../src/validators/DocumentValidator');

describe('DocumentValidator', () => {
    let validator;

    beforeEach(() => {
        validator = new DocumentValidator();
    });

    // ═══════════════════════════════════════════════════════════════════════
    // validateCPF
    // ═══════════════════════════════════════════════════════════════════════
    describe('validateCPF()', () => {

        describe('CPFs válidos', () => {
            test.each([
                ['52998224725', 'CPF normal válido'],
                ['01234567890', 'CPF começando com zero — preservação crítica'],
                ['00000000191', 'CPF com muitos zeros mas matematicamente válido'],
                ['98765432100', 'CPF de sequência decrescente'],
            ])('%s — %s', (cpf) => {
                expect(validator.validateCPF(cpf)).toBe(true);
            });
        });

        describe('CPFs inválidos', () => {
            test.each([
                ['', 'string vazia'],
                ['1234567890', 'menos de 11 dígitos (10)'],
                ['123456789012', 'mais de 11 dígitos (12)'],
                ['11111111111', 'todos dígitos iguais — 1'],
                ['00000000000', 'todos dígitos iguais — 0'],
                ['99999999999', 'todos dígitos iguais — 9'],
                ['12345678900', 'dígitos verificadores errados'],
                ['52998224726', 'último dígito errado em 1'],
                ['abcdefghijk', 'letras em vez de números'],
                [null, 'null'],
                [undefined, 'undefined'],
            ])('%s — %s', (cpf) => {
                expect(validator.validateCPF(cpf)).toBe(false);
            });
        });

        test('CPF com zero à esquerda: não perde o zero na validação', () => {
            expect(validator.validateCPF('01234567890')).toBe(true);
        });
    });

    // ═══════════════════════════════════════════════════════════════════════
    // validateCNPJ
    // ═══════════════════════════════════════════════════════════════════════
    describe('validateCNPJ()', () => {

        describe('CNPJs válidos', () => {
            test.each([
                ['11222333000181', 'CNPJ normal válido'],
                ['11444777000161', 'outro CNPJ válido'],
                ['00000000000191', 'CNPJ com zeros à esquerda'],
            ])('%s — %s', (cnpj) => {
                expect(validator.validateCNPJ(cnpj)).toBe(true);
            });
        });

        describe('CNPJs inválidos', () => {
            test.each([
                ['', 'string vazia'],
                ['1122233300018', 'menos de 14 dígitos (13)'],
                ['112223330001810', 'mais de 14 dígitos (15)'],
                ['11111111111111', 'todos dígitos iguais'],
                ['00000000000000', 'todos zeros'],
                ['11222333000182', 'último dígito errado'],
                [null, 'null'],
            ])('%s — %s', (cnpj) => {
                expect(validator.validateCNPJ(cnpj)).toBe(false);
            });
        });

        test('CNPJ de empresa extinta: matematicamente válido mesmo assim', () => {
            expect(validator.validateCNPJ('11222333000181')).toBe(true);
        });
    });

    // ═══════════════════════════════════════════════════════════════════════
    // identify()
    // ═══════════════════════════════════════════════════════════════════════
    describe('identify()', () => {

        test('identifica CPF válido corretamente', () => {
            const result = validator.identify('529.982.247-25');
            expect(result).toEqual({
                digits: '52998224725',
                type: 'CPF',
                valid: true,
                ambiguous: false,
            });
        });

        test('identifica CNPJ válido corretamente', () => {
            const result = validator.identify('11.222.333/0001-81');
            expect(result).toEqual({
                digits: '11222333000181',
                type: 'CNPJ',
                valid: true,
                ambiguous: false,
            });
        });

        test('identifica CPF inválido — tipo correto mas valid=false', () => {
            const result = validator.identify('12345678900');
            expect(result.type).toBe('CPF');
            expect(result.valid).toBe(false);
            expect(result.digits).toBe('12345678900');
        });

        test('texto com 11 dígitos: identifica como CPF mesmo com texto misto', () => {
            const result = validator.identify('meu cpf é 52998224725 obrigado');
            expect(result.type).toBe('CPF');
            expect(result.digits).toBe('52998224725');
        });

        test('retorna ambiguous=true para string vazia', () => {
            const result = validator.identify('');
            expect(result.type).toBeNull();
            expect(result.valid).toBe(false);
            expect(result.ambiguous).toBe(true);
        });

        test('retorna type=null para 12 dígitos (nem CPF nem CNPJ)', () => {
            const result = validator.identify('123456789012');
            expect(result.type).toBeNull();
            expect(result.valid).toBe(false);
            expect(result.ambiguous).toBe(false);
        });

        test('extrai apenas dígitos antes de identificar', () => {
            const result = validator.identify('529 982 247-25');
            expect(result.digits).toBe('52998224725');
            expect(result.type).toBe('CPF');
        });
    });

    // ═══════════════════════════════════════════════════════════════════════
    // isOperatorCorrection()
    // ═══════════════════════════════════════════════════════════════════════
    describe('isOperatorCorrection()', () => {

        describe('deve retornar TRUE (correção do operador)', () => {
            test.each([
                ['52998224725', 'CPF sem formatação'],
                ['11222333000181', 'CNPJ sem formatação'],
                ['529 982 247 25', 'CPF com espaços acidentais'],
                ['529-982-247-25', 'CPF com hífens acidentais'],
                ['112.223.330.001.81', 'CNPJ com pontos acidentais — 14 dígitos'],
            ])('"%s" — %s', (bio) => {
                expect(validator.isOperatorCorrection(bio)).toBe(true);
            });
        });

        describe('deve retornar FALSE (não é correção simples)', () => {
            test.each([
                ['CPF: 529.982.247-25', 'tem prefixo "CPF:"'],
                ['CNPJ: 11.222.333/0001-81', 'tem prefixo "CNPJ:"'],
                ['CPF: 12345678900 [INVÁLIDO]', 'marcado como inválido pelo sistema'],
                ['meu cpf é 52998224725', 'texto misturado com dígitos'],
                ['', 'string vazia'],
                ['   ', 'apenas espaços'],
                ['123', 'menos de 11 dígitos'],
                ['1234567890123456', 'mais de 14 dígitos'],
                ['João Silva', 'apenas texto'],
            ])('"%s" — %s', (bio) => {
                expect(validator.isOperatorCorrection(bio)).toBe(false);
            });
        });

        test('null retorna false sem lançar erro', () => {
            expect(() => validator.isOperatorCorrection(null)).not.toThrow();
            expect(validator.isOperatorCorrection(null)).toBe(false);
        });
    });
});