/**
 * @fileoverview Testes de SheetService.
 * Foco especial em getColumnIndex() e resiliência a mudanças no Forms.
 */

'use strict';

const { AppConfig } = require('../../src/config/AppConfig');
const { Logger } = require('../../src/utils/Logger');
const { SheetService } = require('../../src/services/SheetService');
const { TestFactory } = require('../helpers/TestFactory');

// Os mocks já estão carregados via setupFiles no jest.config.js

describe('SheetService', () => {
    let appConfig;
    let logger;
    let sheetService;
    let mockSheet;

    beforeEach(() => {
        appConfig = TestFactory.appConfig();
        logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
        sheetService = new SheetService(appConfig, logger);

        // Sheet com cabeçalho padrão PF
        mockSheet = SpreadsheetApp._createSheetMock('PF', [
            ['Data', 'Tipo', 'Nome', 'Sobrenome', 'CPF', 'Endereço', 'Número',
                'Complemento', 'Telefone', 'Email', 'Status', 'ResourceName', 'Última Atualização'],
            ['16/03/2026', 'Pessoa Física', 'João', 'Silva', '52998224725',
                'Rua A', '1', 'Apto 1', '11912345678', 'j@j.com', 'Sincronizado',
                'people/c123', '2026-03-16'],
        ]);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    // ═══════════════════════════════════════════════════════════════════════
    // getColumnIndex()
    // ═══════════════════════════════════════════════════════════════════════
    describe('getColumnIndex()', () => {

        test('retorna índice correto (1-based) para coluna existente', () => {
            expect(sheetService.getColumnIndex(mockSheet, 'Nome')).toBe(3);
            expect(sheetService.getColumnIndex(mockSheet, 'CPF')).toBe(5);
            expect(sheetService.getColumnIndex(mockSheet, 'ResourceName')).toBe(12);
        });

        test('coluna na posição 1 retorna 1', () => {
            expect(sheetService.getColumnIndex(mockSheet, 'Data')).toBe(1);
        });

        test('última coluna retorna índice correto', () => {
            expect(sheetService.getColumnIndex(mockSheet, 'Última Atualização')).toBe(13);
        });

        test('lança erro descritivo se coluna não encontrada', () => {
            expect(() => {
                sheetService.getColumnIndex(mockSheet, 'ColunaQueNaoExiste');
            }).toThrow(/ColunaQueNaoExiste/);

            expect(() => {
                sheetService.getColumnIndex(mockSheet, 'ColunaQueNaoExiste');
            }).toThrow(/PF/);
        });

        test('usa cache na segunda chamada (não relê a planilha)', () => {
            sheetService.getColumnIndex(mockSheet, 'Nome');
            sheetService.getColumnIndex(mockSheet, 'Nome');

            expect(mockSheet.getRange).toHaveBeenCalledTimes(1);
        });

        test('cache por aba: duas abas diferentes têm caches independentes', () => {
            const mockSheet2 = SpreadsheetApp._createSheetMock('PJ', [
                ['Data', 'Tipo', 'Nome Responsável', 'Empresa', 'CNPJ',
                    'Endereço', 'Número', 'Complemento', 'Telefone', 'Email',
                    'Status', 'ResourceName', 'Última Atualização'],
            ]);

            sheetService.getColumnIndex(mockSheet, 'Nome');
            sheetService.getColumnIndex(mockSheet2, 'CNPJ');

            expect(() => {
                sheetService.getColumnIndex(mockSheet, 'CNPJ');
            }).toThrow();
        });

        test('clearColumnCache() força releitura na próxima chamada', () => {
            sheetService.getColumnIndex(mockSheet, 'Nome');
            const callsBefore = mockSheet.getRange.mock.calls.length;

            sheetService.clearColumnCache('PF');
            sheetService.getColumnIndex(mockSheet, 'Nome');

            expect(mockSheet.getRange.mock.calls.length).toBeGreaterThan(callsBefore);
        });

        // ── Resiliência a mudanças no Forms ──────────────────────────────
        test('funciona corretamente se cliente adicionar coluna extra no Forms', () => {
            const sheetComColunaExtra = SpreadsheetApp._createSheetMock('PF', [
                ['Data', 'Tipo', 'Nome', 'Sobrenome', 'CPF', 'Endereço', 'Número',
                    'Complemento', 'Telefone', 'Email', 'Origem',
                    'Status', 'ResourceName', 'Última Atualização'],
            ]);

            expect(sheetService.getColumnIndex(sheetComColunaExtra, 'Status')).toBe(12);
            expect(sheetService.getColumnIndex(sheetComColunaExtra, 'ResourceName')).toBe(13);
        });

        test('funciona se cliente reordenar perguntas no Forms', () => {
            const sheetReordenada = SpreadsheetApp._createSheetMock('PF', [
                ['Data', 'Tipo', 'CPF', 'Nome', 'Sobrenome', 'Endereço',
                    'Número', 'Complemento', 'Telefone', 'Email',
                    'Status', 'ResourceName', 'Última Atualização'],
            ]);

            expect(sheetService.getColumnIndex(sheetReordenada, 'CPF')).toBe(3);
            expect(sheetService.getColumnIndex(sheetReordenada, 'Nome')).toBe(4);
        });
    });

    // ═══════════════════════════════════════════════════════════════════════
    // getSheetRespostas(), getSheetPF(), getSheetPJ()
    // ═══════════════════════════════════════════════════════════════════════
    describe('getters de sheets', () => {
        test('getSheetRespostas() retorna a aba de respostas configurada', () => {
            const sheet = sheetService.getSheetRespostas();
            expect(sheet).toBeDefined();
        });

        test('getSheetPF() retorna a aba PF configurada', () => {
            const sheet = sheetService.getSheetPF();
            expect(sheet).toBeDefined();
            expect(sheet.getName()).toBe('PF');
        });

        test('getSheetPJ() retorna a aba PJ configurada', () => {
            const sheet = sheetService.getSheetPJ();
            expect(sheet).toBeDefined();
            expect(sheet.getName()).toBe('PJ');
        });
    });

    // ═══════════════════════════════════════════════════════════════════════
    // escreverNovaLinha()
    // ═══════════════════════════════════════════════════════════════════════
    describe('escreverNovaLinha()', () => {
        test('escreve linha corretamente para PF', () => {
            const dados = TestFactory.validPF();
            const novaLinha = sheetService.escreverNovaLinha(mockSheet, dados, 'Pessoa Física', 'Processando...');

            expect(novaLinha).toBe(3); // Começou com 2 linhas, nova é 3
            expect(mockSheet.appendRow).toHaveBeenCalled();
        });

        test('escreve linha corretamente para PJ', () => {
            const pjSheet = SpreadsheetApp._createSheetMock('PJ', [
                ['Data', 'Nome Responsável', 'Empresa', 'CNPJ', 'Endereço', 'Número',
                    'Complemento', 'Telefone', 'Email', 'Status', 'ResourceName', 'Última Atualização'],
            ]);
            const dados = TestFactory.validPJ();
            const novaLinha = sheetService.escreverNovaLinha(pjSheet, dados, 'Pessoa Jurídica', 'Processando...');

            expect(novaLinha).toBe(2);
            expect(pjSheet.appendRow).toHaveBeenCalled();
        });
    });

    // ═══════════════════════════════════════════════════════════════════════
    // findDuplicateDoc()
    // ═══════════════════════════════════════════════════════════════════════
    describe('findDuplicateDoc()', () => {

        test('encontra DOC duplicado e retorna a linha correta', () => {
            const result = sheetService.verificarDuplicidadeDoc(mockSheet, '52998224725');
            expect(result.encontrado).toBe(true);
            expect(result.linha).toBe(2);
        });

        test('retorna encontrado=false quando DOC não existe', () => {
            const result = sheetService.verificarDuplicidadeDoc(mockSheet, '99999999999');
            expect(result.encontrado).toBe(false);
            expect(result.linha).toBeNull();
        });

        test('ignora formatação: encontra CPF com máscara na planilha', () => {
            const sheetComMascara = SpreadsheetApp._createSheetMock('PF', [
                ['Data', 'Tipo', 'Nome', 'Sobrenome', 'CPF', 'Endereço', 'Número',
                    'Complemento', 'Telefone', 'Email', 'Status', 'ResourceName', 'Última Atualização'],
                ['16/03/2026', 'PF', 'João', 'Silva', '529.982.247-25',
                    'R A', '1', '', '11912345678', 'j@j.com', 'Sync', 'people/c1', '2026-03-16'],
            ]);

            const result = sheetService.verificarDuplicidadeDoc(sheetComMascara, '52998224725');
            expect(result.encontrado).toBe(true);
        });

        test('planilha vazia retorna encontrado=false sem erro', () => {
            const emptySheet = SpreadsheetApp._createSheetMock('PF', [
                ['Data', 'CPF'],
            ]);
            const result = sheetService.verificarDuplicidadeDoc(emptySheet, '52998224725');
            expect(result.encontrado).toBe(false);
        });

        test('funciona mesmo se coluna DOC foi movida no Forms', () => {
            const reorderedSheet = SpreadsheetApp._createSheetMock('PF', [
                ['Data', 'Tipo', 'CPF', 'Nome', 'Sobrenome', 'Endereço',
                    'Número', 'Complemento', 'Telefone', 'Email',
                    'Status', 'ResourceName', 'Última Atualização'],
                ['16/03/2026', 'PF', '52998224725', 'João', 'Silva',
                    'R A', '1', '', '11912345678', 'j@j.com', 'Sync', 'people/c1', '2026-03-16'],
            ]);

            const result = sheetService.verificarDuplicidadeDoc(reorderedSheet, '52998224725');
            expect(result.encontrado).toBe(true);
            expect(result.linha).toBe(2);
        });
    });

    // ═══════════════════════════════════════════════════════════════════════
    // encontrarLinhaPorResourceName()
    // ═══════════════════════════════════════════════════════════════════════
    describe('encontrarLinhaPorResourceName()', () => {
        test('encontra a linha correta pelo resourceName', () => {
            const result = sheetService.encontrarLinhaPorResourceName('people/c123');
            expect(result.row).toBe(2);
            expect(result.sheet.getName()).toBe('PF');
        });

        test('retorna null se resourceName não encontrado', () => {
            const result = sheetService.encontrarLinhaPorResourceName('people/c999');
            expect(result.row).toBeNull();
            expect(result.sheet).toBeNull();
        });
    });

    // ═══════════════════════════════════════════════════════════════════════
    // setDocLinha() com forceText
    // ═══════════════════════════════════════════════════════════════════════
    describe('setDocLinha()', () => {
        test('setDocLinha aplica @STRING@ antes de setValue', () => {
            sheetService.setDocLinha(mockSheet, 2, '01234567890');

            const allCalls = mockSheet.getRange.mock.results
                .map(r => r.value)
                .filter(Boolean);
            const formattedCell = allCalls.find(
                cell => cell.setNumberFormat && cell.setNumberFormat.mock.calls.length > 0
            );
            expect(formattedCell).toBeDefined();
            expect(formattedCell.setNumberFormat).toHaveBeenCalledWith('@STRING@');
        });
    });
});