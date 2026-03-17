/**
 * @fileoverview Serviço de interação com Google Sheets.
 *
 * DECISÃO DE ARQUITETURA — MAPEAMENTO DINÂMICO DE COLUNAS:
 * SheetService NUNCA usa índice de coluna hardcoded. Toda leitura/escrita
 * é feita via getColumnIndex(sheet, headerName), que localiza a coluna
 * pelo nome do cabeçalho na linha 1.
 *
 * Isso resolve dois problemas críticos:
 * 1. O Google Forms define a ordem das colunas — se o cliente reordenar
 *    perguntas, o script continua funcionando.
 * 2. O conflito latente entre COLUNA_EMAIL e COLUNA_STATUS no código
 *    original (ambas mapeavam para índices próximos) é eliminado porque
 *    cada coluna é localizada pelo seu nome, não por posição.
 *
 * ⚠️ GAS RUNTIME: getRange() e getValues() são chamadas à Sheets API.
 * Agrupe leituras sempre que possível para evitar atingir o limite de quota.
 *
 * 📋 FORMS: O script NUNCA recria nem deleta abas vinculadas ao Forms.
 * addScriptColumns() apenas ACRESCENTA colunas à direita se não existirem.
 */
class SheetService {
    /**
     * @param {AppConfig} appConfig - Instância de configuração do tenant
     * @param {Logger} logger - Instância do logger
     * @param {Object} [spreadsheetApp] - Injetado para testes
     */
    constructor(appConfig, logger, spreadsheetApp) {
        this._config = appConfig;
        this._logger = logger;
        this._ss = spreadsheetApp || SpreadsheetApp;

        // Cache de índices de colunas por aba: { sheetName: { headerName: colIndex } }
        // Invalidado ao chamar clearColumnCache()
        this._columnIndexCache = {};
    }

    // ─────────────────────────────────────────────────────────────────────────
    // SEÇÃO 1: LOCALIZAÇÃO DE COLUNAS (núcleo da resiliência ao Forms)
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Retorna o índice (1-based) de uma coluna pelo nome do cabeçalho.
     * Usa cache interno para evitar releituras desnecessárias da API.
     *
     * 📋 FORMS: a linha 1 é o cabeçalho. O Google Forms sempre insere
     * "Data" (ou equivalente configurado) como primeira coluna.
     *
     * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet - Aba da planilha
     * @param {string} headerName - Nome do cabeçalho a localizar
     * @returns {number} Índice 1-based da coluna
     * @throws {Error} Se o cabeçalho não for encontrado na aba
     */
    getColumnIndex(sheet, headerName) {
        const sheetName = sheet.getName();

        // Inicializa cache da aba se necessário
        if (!this._columnIndexCache[sheetName]) {
            this._columnIndexCache[sheetName] = {};
        }

        // Retorna do cache se já foi resolvido
        if (this._columnIndexCache[sheetName][headerName] !== undefined) {
            return this._columnIndexCache[sheetName][headerName];
        }

        // Lê a linha de cabeçalho inteira (uma única chamada à API)
        const headerRow = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
        const index = headerRow.findIndex(
            cell => cell.toString().trim() === headerName.trim()
        );

        if (index === -1) {
            throw new Error(
                `[VelozzCRM] Coluna "${headerName}" não encontrada na aba "${sheetName}". ` +
                `Verifique se o cabeçalho da planilha corresponde à configuração COL_* em AppConfig. ` +
                `Cabeçalhos encontrados: [${headerRow.join(', ')}]`
            );
        }

        // +1 porque GAS usa índice 1-based
        const colIndex = index + 1;
        this._columnIndexCache[sheetName][headerName] = colIndex;
        return colIndex;
    }

    /**
     * Invalida o cache de índices de colunas de uma aba específica.
     * Deve ser chamado após addScriptColumns() ou mudanças de estrutura.
     * @param {string} [sheetName] - Se omitido, invalida todo o cache
     */
    clearColumnCache(sheetName) {
        if (sheetName) {
            delete this._columnIndexCache[sheetName];
        } else {
            this._columnIndexCache = {};
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // SEÇÃO 2: VALIDAÇÃO DE ESTRUTURA (usado no setupInicial)
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Valida se uma aba possui todos os cabeçalhos esperados.
     * Retorna um relatório de compatibilidade — não lança exceção —
     * para que setupInicial() possa exibir todas as colunas faltantes
     * de uma vez, não uma por vez.
     *
     * 📋 FORMS: as colunas adicionadas pelo script (Status, ResourceName,
     * Última Atualização) podem não existir ainda na primeira execução —
     * isso é normal e esperado. addScriptColumns() as cria.
     *
     * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet - Aba a validar
     * @param {'PF'|'PJ'} tipo - Tipo da aba
     * @returns {{ valid: boolean, missing: string[], found: string[] }}
     */
    validateSheetStructure(sheet, tipo) {
        const expectedHeaders = this._config.getExpectedHeaders(tipo);
        const headerRow = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]
            .map(h => h.toString().trim());

        const missing = [];
        const found = [];

        // Colunas do script não são obrigatórias na validação inicial
        const scriptOnlyCols = [
            this._config.get('COL_STATUS'),
            this._config.get('COL_RESOURCE'),
            this._config.get('COL_SYNC'),
        ];

        Object.values(expectedHeaders).forEach(headerName => {
            if (scriptOnlyCols.includes(headerName)) {
                found.push(`${headerName} (será criada pelo script)`);
                return;
            }
            if (headerRow.includes(headerName)) {
                found.push(headerName);
            } else {
                missing.push(headerName);
            }
        });

        return {
            valid: missing.length === 0,
            missing,
            found,
        };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // SEÇÃO 3: GESTÃO DAS COLUNAS DO SCRIPT
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Adiciona as colunas gerenciadas pelo script (Status, ResourceName,
     * Última Atualização) à direita das colunas do Forms, SE não existirem.
     *
     * 📋 FORMS: este método NUNCA toca nas colunas geradas pelo formulário.
     * Ele apenas acrescenta colunas à direita do último cabeçalho existente.
     *
     * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet - Aba a complementar
     */
    addScriptColumns(sheet) {
        const headers = this._config.config.headers;
        const scriptCols = [
            headers.status,
            headers.resourceName,
            headers.ultimaAtualizacao,
        ];

        const lastCol = sheet.getLastColumn();
        const existingHeaders = sheet
            .getRange(1, 1, 1, lastCol)
            .getValues()[0]
            .map(h => h.toString().trim());

        let colsAdded = 0;
        scriptCols.forEach((colName) => {
            if (!existingHeaders.includes(colName)) {
                colsAdded++;
                const newColIndex = lastCol + colsAdded;
                sheet.getRange(1, newColIndex).setValue(colName).setFontWeight('bold');
            }
        });

        // Invalida cache porque a estrutura mudou
        this.clearColumnCache(sheet.getName());
    }

    // ─────────────────────────────────────────────────────────────────────────
    // SEÇÃO 4: LEITURA E ESCRITA DE DADOS
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Lê todos os valores de uma linha como objeto chave/valor,
     * usando os cabeçalhos como chaves.
     *
     * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
     * @param {number} row - Número da linha (1-based)
     * @returns {Object.<string, *>} Mapa { headerName → valor }
     */
    getRowAsObject(sheet, row) {
        const lastCol = sheet.getLastColumn();
        const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
        const values = sheet.getRange(row, 1, 1, lastCol).getValues()[0];

        const result = {};
        headers.forEach((header, i) => {
            result[header.toString().trim()] = values[i];
        });
        return result;
    }

    /**
     * Escreve um valor em uma célula específica identificada pelo
     * nome do cabeçalho, garantindo formato texto para preservar zeros.
     *
     * ⚠️ BUG FIX: CPF/CNPJ começando com 0 perdem o zero se a célula
     * for tratada como número. setNumberFormat('@STRING@') força texto.
     *
     * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
     * @param {number} row - Linha de destino (1-based)
     * @param {string} headerName - Nome do cabeçalho da coluna
     * @param {*} value - Valor a escrever
     * @param {boolean} [forceText=false] - Se true, aplica @STRING@ antes
     */
    setCellByHeader(sheet, row, headerName, value, forceText) {
        const col = this.getColumnIndex(sheet, headerName);
        const cell = sheet.getRange(row, col);
        if (forceText) cell.setNumberFormat('@STRING@');
        cell.setValue(value);
    }

    /**
     * Lê o valor de uma célula identificada pelo nome do cabeçalho.
     * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
     * @param {number} row - Linha (1-based)
     * @param {string} headerName - Nome do cabeçalho da coluna
     * @returns {*} Valor da célula
     */
    getCellByHeader(sheet, row, headerName) {
        const col = this.getColumnIndex(sheet, headerName);
        return sheet.getRange(row, col).getValue();
    }

    /**
     * Protege um intervalo de colunas contra edição manual.
     * Usado para proteger ResourceName e Última Atualização.
     *
     * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
     * @param {string} fromHeader - Cabeçalho da primeira coluna a proteger
     * @param {string} toHeader - Cabeçalho da última coluna a proteger
     * @param {string} description - Descrição da proteção
     */
    protectColumnRange(sheet, fromHeader, toHeader, description) {
        const fromCol = this.getColumnIndex(sheet, fromHeader);
        const toCol = this.getColumnIndex(sheet, toHeader);
        const numCols = toCol - fromCol + 1;

        const protection = sheet
            .getRange(1, fromCol, sheet.getMaxRows(), numCols)
            .protect();
        protection.setDescription(description);
        protection.removeEditors(protection.getEditors());
        if (protection.canDomainEdit()) protection.setDomainEdit(false);
    }

    /**
     * Localiza a linha de um contato pelo seu ResourceName.
     * Usa TextFinder para performance em planilhas grandes.
     *
     * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
     * @param {string} resourceName - ID do contato no Google Contacts
     * @returns {number|null} Número da linha (1-based) ou null se não encontrado
     */
    findRowByResourceName(sheet, resourceName) {
        const headers = this._config.config.headers;
        const colIndex = this.getColumnIndex(sheet, headers.resourceName);
        const finder = sheet
            .getRange(1, colIndex, sheet.getMaxRows(), 1)
            .createTextFinder(resourceName)
            .matchEntireCell(true)
            .findNext();

        return finder ? finder.getRow() : null;
    }

    /**
     * Verifica se um documento já existe na coluna DOC de uma aba.
     * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
     * @param {string} docLimpo - Documento com apenas dígitos
     * @param {string} docHeaderName - Nome do cabeçalho da coluna DOC
     * @returns {{ found: boolean, row: number|null }}
     */
    findDuplicateDoc(sheet, docLimpo, docHeaderName) {
        const lastRow = sheet.getLastRow();
        if (lastRow < 2) return { found: false, row: null };

        const colIndex = this.getColumnIndex(sheet, docHeaderName);
        const values = sheet
            .getRange(2, colIndex, lastRow - 1, 1)
            .getValues();

        for (let i = 0; i < values.length; i++) {
            const existing = (values[i][0] || '').toString().replace(/\D/g, '');
            if (existing === docLimpo) {
                return { found: true, row: i + 2 };
            }
        }
        return { found: false, row: null };
    }

    /**
     * Retorna a aba pelo nome configurado.
     * @param {'PF'|'PJ'|'LOG'} sheetType - Tipo da aba
     * @returns {GoogleAppsScript.Spreadsheet.Sheet|null}
     */
    getSheet(sheetType) {
        const ss = this._ss.getActiveSpreadsheet();
        const nameMap = {
            PF: this._config.config.sheetPF,
            PJ: this._config.config.sheetPJ,
            LOG: this._config.config.sheetLog,
        };
        return ss.getSheetByName(nameMap[sheetType]) || null;
    }
}