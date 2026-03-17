/**
 * @fileoverview Testes de SheetService.
 * Foco especial em getColumnIndex() e resiliência a mudanças no Forms.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { TestFactory } = require('../helpers/TestFactory');

// Carrega dependências na ordem correta (sem módulos ES)
[
    '../../src/config/AppConfig.js',
    '../../src/utils/Formatter.js',
    '../../src/utils/Logger.js',
    '../../src/services/SheetService.js',
].forEach(f => eval(fs.readFileSync(path.join(__dirname, f), 'utf8')));

describe('SheetService', () => {
    let appConfig;
    let logger;
    let sheetService;
    let mockSheet;

    beforeEach(() => {
        appConfig = TestFactory.appConfig();

        // Logger silencioso para não poluir output dos testes
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
            }).toThrow(/PF/); // Menciona o nome da aba no erro
        });

        test('usa cache na segunda chamada (não relê a planilha)', () => {
            sheetService.getColumnIndex(mockSheet, 'Nome');
            sheetService.getColumnIndex(mockSheet, 'Nome');

            // getRange só deve ter sido chamado UMA vez (para carregar o cache)
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

            // CNPJ não existe na aba PF
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
            // Cliente inseriu "Origem" entre "Email" e "Status"
            const sheetComColunaExtra = SpreadsheetApp._createSheetMock('PF', [
                ['Data', 'Tipo', 'Nome', 'Sobrenome', 'CPF', 'Endereço', 'Número',
                    'Complemento', 'Telefone', 'Email', 'Origem', // ← coluna extra
                    'Status', 'ResourceName', 'Última Atualização'],
            ]);

            // Status agora está na col 12, não 11 — deve localizar corretamente
            expect(sheetService.getColumnIndex(sheetComColunaExtra, 'Status')).toBe(12);
            expect(sheetService.getColumnIndex(sheetComColunaExtra, 'ResourceName')).toBe(13);
        });

        test('funciona se cliente reordenar perguntas no Forms', () => {
            // CPF foi movido para a posição 3 (antes de Nome)
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
    // validateSheetStructure()
    // ═══════════════════════════════════════════════════════════════════════
    describe('validateSheetStructure()', () => {

        test('retorna valid=true para aba PF com estrutura completa', () => {
            const result = sheetService.validateSheetStructure(mockSheet, 'PF');
            expect(result.valid).toBe(true);
            expect(result.missing).toHaveLength(0);
        });

        test('retorna missing com colunas ausentes', () => {
            // Aba sem coluna CPF e sem Telefone
            const incompleteSheet = SpreadsheetApp._createSheetMock('PF', [
                ['Data', 'Tipo', 'Nome', 'Sobrenome', 'Endereço',
                    'Número', 'Complemento', 'Email',
                    'Status', 'ResourceName', 'Última Atualização'],
            ]);

            const result = sheetService.validateSheetStructure(incompleteSheet, 'PF');
            expect(result.valid).toBe(false);
            expect(result.missing).toContain('CPF');
            expect(result.missing).toContain('Telefone');
        });

        test('colunas do script são tratadas como "serão criadas" (não missing)', () => {
            // Aba sem Status, ResourceName, Última Atualização (ainda não setupada)
            const freshSheet = SpreadsheetApp._createSheetMock('PF', [
                ['Data', 'Tipo', 'Nome', 'Sobrenome', 'CPF', 'Endereço',
                    'Número', 'Complemento', 'Telefone', 'Email'],
            ]);

            const result = sheetService.validateSheetStructure(freshSheet, 'PF');
            // Não deve estar em missing — são criadas pelo script
            expect(result.missing).not.toContain('Status');
            expect(result.missing).not.toContain('ResourceName');
            // Mas devem estar em found com nota
            const foundStatus = result.found.find(f => f.includes('Status'));
            expect(foundStatus).toContain('será criada');
        });

        test('aba PJ valida colunas específicas de PJ (CNPJ, Empresa)', () => {
            const pjSheet = SpreadsheetApp._createSheetMock('PJ', [
                ['Data', 'Tipo', 'Nome Responsável', 'Empresa', 'CNPJ',
                    'Endereço', 'Número', 'Complemento', 'Telefone', 'Email',
                    'Status', 'ResourceName', 'Última Atualização'],
            ]);

            const result = sheetService.validateSheetStructure(pjSheet, 'PJ');
            expect(result.valid).toBe(true);
            expect(result.missing).not.toContain('CNPJ');
            expect(result.missing).not.toContain('Empresa');
        });
    });

    // ═══════════════════════════════════════════════════════════════════════
    // findDuplicateDoc()
    // ═══════════════════════════════════════════════════════════════════════
    describe('findDuplicateDoc()', () => {

        test('encontra DOC duplicado e retorna a linha correta', () => {
            const result = sheetService.findDuplicateDoc(
                mockSheet, '52998224725', 'CPF'
            );
            expect(result.found).toBe(true);
            expect(result.row).toBe(2);
        });

        test('retorna found=false quando DOC não existe', () => {
            const result = sheetService.findDuplicateDoc(
                mockSheet, '99999999999', 'CPF'
            );
            expect(result.found).toBe(false);
            expect(result.row).toBeNull();
        });

        test('ignora formatação: encontra CPF com máscara na planilha', () => {
            const sheetComMascara = SpreadsheetApp._createSheetMock('PF', [
                ['Data', 'Tipo', 'Nome', 'Sobrenome', 'CPF', 'Endereço', 'Número',
                    'Complemento', 'Telefone', 'Email', 'Status', 'ResourceName', 'Última Atualização'],
                ['16/03/2026', 'PF', 'João', 'Silva', '529.982.247-25', // CPF com máscara
                    'R A', '1', '', '11912345678', 'j@j.com', 'Sync', 'people/c1', '2026-03-16'],
            ]);

            const result = sheetService.findDuplicateDoc(
                sheetComMascara, '52998224725', 'CPF'
            );
            expect(result.found).toBe(true);
        });

        test('planilha vazia retorna found=false sem erro', () => {
            const emptySheet = SpreadsheetApp._createSheetMock('PF', [
                ['Data', 'CPF'],
            ]);
            const result = sheetService.findDuplicateDoc(emptySheet, '52998224725', 'CPF');
            expect(result.found).toBe(false);
        });

        test('funciona mesmo se coluna DOC foi movida no Forms', () => {
            // CPF agora está na posição 3 (não 5)
            const reorderedSheet = SpreadsheetApp._createSheetMock('PF', [
                ['Data', 'Tipo', 'CPF', 'Nome', 'Sobrenome', 'Endereço',
                    'Número', 'Complemento', 'Telefone', 'Email',
                    'Status', 'ResourceName', 'Última Atualização'],
                ['16/03/2026', 'PF', '52998224725', 'João', 'Silva',
                    'R A', '1', '', '11912345678', 'j@j.com', 'Sync', 'people/c1', '2026-03-16'],
            ]);

            const result = sheetService.findDuplicateDoc(
                reorderedSheet, '52998224725', 'CPF'
            );
            expect(result.found).toBe(true);
            expect(result.row).toBe(2);
        });
    });

    // ═══════════════════════════════════════════════════════════════════════
    // setCellByHeader() e getCellByHeader()
    // ═══════════════════════════════════════════════════════════════════════
    describe('setCellByHeader() / getCellByHeader()', () => {

        test('escreve e lê o valor correto pelo nome do cabeçalho', () => {
            sheetService.setCellByHeader(mockSheet, 2, 'Status', 'Sincronizado');
            const val = sheetService.getCellByHeader(mockSheet, 2, 'Status');
            expect(val).toBe('Sincronizado');
        });

        test('forceText=true aplica @STRING@ antes de setValue', () => {
            sheetService.setCellByHeader(mockSheet, 2, 'CPF', '01234567890', true);
            // Verifica que setNumberFormat foi chamado com @STRING@
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

    // ═══════════════════════════════════════════════════════════════════════
    // findRowByResourceName()
    // ═══════════════════════════════════════════════════════════════════════
    describe('findRowByResourceName()', () => {

        test('encontra a linha correta pelo resourceName', () => {
            const row = sheetService.findRowByResourceName(mockSheet, 'people/c123');
            expect(row).toBe(2);
        });

        test('retorna null se resourceName não encontrado', () => {
            const row = sheetService.findRowByResourceName(mockSheet, 'people/c999');
            expect(row).toBeNull();
        });
    });
});