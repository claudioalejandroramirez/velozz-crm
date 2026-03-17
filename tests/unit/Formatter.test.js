/**
 * @fileoverview Testes de Formatter.
 * Cobertura: formatação de telefone, documento e normalização.
 */

'use strict';

const fs = require('fs');
const path = require('path');
eval(fs.readFileSync(
    path.join(__dirname, '../../src/utils/Formatter.js'), 'utf8'
));

describe('Formatter', () => {

    // ═══════════════════════════════════════════════════════════════════════
    // phone()
    // ═══════════════════════════════════════════════════════════════════════
    describe('phone()', () => {

        describe('celular (11 dígitos)', () => {
            test.each([
                ['11912345678', '(11) 91234-5678'],
                ['21987654321', '(21) 98765-4321'],
                ['01912345678', '(01) 91234-5678'], // DDD com zero
            ])('%s → %s', (input, expected) => {
                expect(Formatter.phone(input)).toBe(expected);
            });
        });

        describe('fixo (10 dígitos)', () => {
            test.each([
                ['1133334444', '(11) 3333-4444'],
                ['2122223333', '(21) 2222-3333'],
            ])('%s → %s', (input, expected) => {
                expect(Formatter.phone(input)).toBe(expected);
            });
        });

        describe('tamanhos inesperados — retorna raw sem erro', () => {
            test.each([
                ['12345678', '8 dígitos sem DDD — retorna raw'],
                ['123456789', '9 dígitos — retorna raw'],
                ['55119123456789', '14 dígitos (DDI + número) — retorna raw'],
            ])('%s — %s', (input) => {
                // Não deve lançar erro — apenas retornar o que veio
                expect(() => Formatter.phone(input)).not.toThrow();
                expect(Formatter.phone(input)).toBe(input);
            });
        });

        test('entrada com máscara: remove máscara antes de formatar', () => {
            // O Formatter recebe dígitos puros — mas testa defensivamente
            expect(Formatter.phone('(11) 91234-5678')).toBe('(11) 91234-5678');
        });

        test('string vazia retorna string vazia', () => {
            expect(Formatter.phone('')).toBe('');
        });

        test('null retorna string vazia', () => {
            expect(Formatter.phone(null)).toBe('');
        });
    });

    // ═══════════════════════════════════════════════════════════════════════
    // document()
    // ═══════════════════════════════════════════════════════════════════════
    describe('document()', () => {

        describe('CPF', () => {
            test.each([
                ['52998224725', '529.982.247-25'],
                ['01234567890', '012.345.678-90'], // zero à esquerda preservado na máscara
                ['00000000191', '000.000.001-91'],
            ])('%s → %s', (doc, expected) => {
                expect(Formatter.document(doc, 'CPF')).toBe(expected);
            });
        });

        describe('CNPJ', () => {
            test.each([
                ['11222333000181', '11.222.333/0001-81'],
                ['00000000000191', '00.000.000/0001-91'],
            ])('%s → %s', (doc, expected) => {
                expect(Formatter.document(doc, 'CNPJ')).toBe(expected);
            });
        });

        test('tipo desconhecido retorna o doc sem formatação', () => {
            expect(Formatter.document('12345', 'RG')).toBe('12345');
        });

        test('doc vazio retorna string vazia', () => {
            expect(Formatter.document('', 'CPF')).toBe('');
        });
    });

    // ═══════════════════════════════════════════════════════════════════════
    // digitsOnly()
    // ═══════════════════════════════════════════════════════════════════════
    describe('digitsOnly()', () => {
        test.each([
            ['529.982.247-25', '52998224725'],
            ['11.222.333/0001-81', '11222333000181'],
            ['(11) 91234-5678', '11912345678'],
            ['abc123def456', '123456'],
            ['', ''],
            [null, ''],
            [undefined, ''],
            [12345, '12345'], // número como input
        ])('"%s" → "%s"', (input, expected) => {
            expect(Formatter.digitsOnly(input)).toBe(expected);
        });
    });

    // ═══════════════════════════════════════════════════════════════════════
    // normalizeEmail()
    // ═══════════════════════════════════════════════════════════════════════
    describe('normalizeEmail()', () => {
        test.each([
            ['Email@Teste.Com', 'email@teste.com'],
            ['  JOAO@X.COM  ', 'joao@x.com'],
            ['a@b.com', 'a@b.com'],
            ['', ''],
            [null, ''],
        ])('"%s" → "%s"', (input, expected) => {
            expect(Formatter.normalizeEmail(input)).toBe(expected);
        });

        test('dois emails diferentes ficam diferentes após normalização', () => {
            const a = Formatter.normalizeEmail('João@Email.com');
            const b = Formatter.normalizeEmail('Maria@Email.com');
            expect(a).not.toBe(b);
        });

        test('mesmo email com casing diferente fica igual após normalização', () => {
            const a = Formatter.normalizeEmail('JOAO@TESTE.COM');
            const b = Formatter.normalizeEmail('joao@teste.com');
            expect(a).toBe(b);
        });
    });
});