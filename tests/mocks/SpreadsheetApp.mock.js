/**
 * @fileoverview Mock do SpreadsheetApp do GAS.
 * Simula Sheet, Range e Spreadsheet com comportamento suficiente
 * para os testes unitários do Velozz CRM.
 */

'use strict';

/**
 * Cria um mock de Sheet com dados inicializáveis.
 * @param {string} name - Nome da aba
 * @param {Array[]} data - Dados da aba [[row1col1, ...], ...]
 * @returns {Object} Mock de Sheet
 */
function createSheetMock(name = 'PF', data = []) {
    // Linha 0 = cabeçalho, linhas 1+ = dados
    const rows = data.length ? JSON.parse(JSON.stringify(data)) : [
        // Cabeçalho padrão PF compatível com AppConfig.DEFAULTS
        ['Data', 'Tipo', 'Nome', 'Sobrenome', 'CPF', 'Endereço', 'Número',
            'Complemento', 'Telefone', 'Email', 'Status', 'ResourceName', 'Última Atualização'],
    ];

    const sheet = {
        _name: name,
        _rows: rows,

        getName: jest.fn(() => name),
        getLastRow: jest.fn(() => rows.length),
        getLastColumn: jest.fn(() => rows[0] ? rows[0].length : 0),
        getMaxRows: jest.fn(() => 1000),

        getRange: jest.fn((row, col, numRows = 1, numCols = 1) => {
            return createRangeMock(sheet, row, col, numRows, numCols);
        }),

        appendRow: jest.fn((rowData) => { rows.push(rowData); }),
        setFrozenRows: jest.fn(),
        hideColumns: jest.fn(),
        hideSheet: jest.fn(),
        showSheet: jest.fn(),
        protect: jest.fn(() => createProtectionMock()),

        // Helper de teste
        _setData: (newData) => {
            rows.length = 0;
            newData.forEach(r => rows.push(r));
        },
        _getData: () => rows,
    };

    return sheet;
}

/**
 * Cria um mock de Range vinculado a um Sheet mock.
 */
function createRangeMock(sheet, startRow, startCol, numRows, numCols) {
    const rows = sheet._rows;

    return {
        getValue: jest.fn(() => {
            const row = rows[startRow - 1];
            return row ? (row[startCol - 1] ?? '') : '';
        }),
        getValues: jest.fn(() => {
            const result = [];
            for (let r = 0; r < numRows; r++) {
                const row = rows[startRow - 1 + r] || [];
                const cols = [];
                for (let c = 0; c < numCols; c++) {
                    cols.push(row[startCol - 1 + c] ?? '');
                }
                result.push(cols);
            }
            return result;
        }),
        setValue: jest.fn((val) => {
            if (!rows[startRow - 1]) rows[startRow - 1] = [];
            rows[startRow - 1][startCol - 1] = val;
        }),
        setValues: jest.fn((vals) => {
            vals.forEach((rowData, ri) => {
                if (!rows[startRow - 1 + ri]) rows[startRow - 1 + ri] = [];
                rowData.forEach((val, ci) => {
                    rows[startRow - 1 + ri][startCol - 1 + ci] = val;
                });
            });
        }),
        setNumberFormat: jest.fn().mockReturnThis(),
        setFontWeight: jest.fn().mockReturnThis(),
        setFontColor: jest.fn().mockReturnThis(),
        protect: jest.fn(() => createProtectionMock()),
        getRow: jest.fn(() => startRow),
        getColumn: jest.fn(() => startCol),
        getSheet: jest.fn(() => sheet),

        createTextFinder: jest.fn((searchText) => ({
            matchEntireCell: jest.fn().mockReturnThis(),
            findNext: jest.fn(() => {
                // Busca nas linhas da coluna especificada
                for (let r = 0; r < rows.length; r++) {
                    const cellVal = rows[r] ? (rows[r][startCol - 1] ?? '') : '';
                    if (String(cellVal) === String(searchText)) {
                        return createRangeMock(sheet, r + 1, startCol, 1, 1);
                    }
                }
                return null;
            }),
        })),
    };
}

function createProtectionMock() {
    return {
        setDescription: jest.fn(),
        removeEditors: jest.fn(),
        getEditors: jest.fn(() => []),
        canDomainEdit: jest.fn(() => false),
        setDomainEdit: jest.fn(),
    };
}

// ── Spreadsheet mock ──────────────────────────────────────────────────────

const defaultSheets = {
    PF: createSheetMock('PF'),
    PJ: createSheetMock('PJ', [
        ['Data', 'Tipo', 'Nome Responsável', 'Empresa', 'CNPJ', 'Endereço', 'Número',
            'Complemento', 'Telefone', 'Email', 'Status', 'ResourceName', 'Última Atualização'],
    ]),
    LOG: createSheetMock('LOG', [['Timestamp', 'Nível', 'Função', 'Mensagem']]),
};

const spreadsheetMock = {
    _sheets: { ...defaultSheets },

    getSheetByName: jest.fn((name) => spreadsheetMock._sheets[name] || null),
    insertSheet: jest.fn((name) => {
        const s = createSheetMock(name);
        spreadsheetMock._sheets[name] = s;
        return s;
    }),
    setActiveSheet: jest.fn(),
    getUi: jest.fn(() => ({
        alert: jest.fn(),
        showModalDialog: jest.fn(),
        createMenu: jest.fn().mockReturnThis(),
        addItem: jest.fn().mockReturnThis(),
        addSeparator: jest.fn().mockReturnThis(),
        addToUi: jest.fn(),
    })),

    // Helpers de teste
    _reset: () => {
        spreadsheetMock._sheets = {
            PF: createSheetMock('PF'),
            PJ: createSheetMock('PJ', [
                ['Data', 'Tipo', 'Nome Responsável', 'Empresa', 'CNPJ', 'Endereço', 'Número',
                    'Complemento', 'Telefone', 'Email', 'Status', 'ResourceName', 'Última Atualização'],
            ]),
            LOG: createSheetMock('LOG', [['Timestamp', 'Nível', 'Função', 'Mensagem']]),
        };
    },
    _getSheet: (name) => spreadsheetMock._sheets[name],
    createSheetMock,
};

global.SpreadsheetApp = {
    getActiveSpreadsheet: jest.fn(() => spreadsheetMock),
    getUi: jest.fn(() => spreadsheetMock.getUi()),
    _mock: spreadsheetMock,
    _createSheetMock: createSheetMock,
};