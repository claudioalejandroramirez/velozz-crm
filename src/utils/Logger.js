/**
 * @fileoverview Wrapper do log persistente em aba oculta do Sheets.
 *
 * DECISÃO DE ARQUITETURA:
 * Logger recebe o SpreadsheetApp e a AppConfig via construtor para
 * permitir mock total em testes sem efeitos colaterais em planilhas reais.
 *
 * Falhas no próprio Logger são silenciosas (console.error apenas) para
 * nunca interromper o fluxo de negócio principal.
 *
 * ⚠️ GAS RUNTIME: appendRow() conta como uma chamada à Sheets API.
 * Em funções chamadas por onEdit (alta frequência), o Logger pode
 * contribuir para o limite de 300 chamadas/minuto. Se necessário,
 * implementar buffer com Utilities.sleep() no roadmap.
 * 💡 ROADMAP: buffer de logs com flush periódico para reduzir chamadas API.
 */
class Logger {
    /**
     * @param {AppConfig} appConfig - Instância de configuração do tenant
     * @param {Object} [spreadsheetApp] - Injetado para testes (padrão: SpreadsheetApp)
     */
    constructor(appConfig, spreadsheetApp) {
        this._config = appConfig;
        this._ss = spreadsheetApp || SpreadsheetApp;
    }

    /**
     * Registra uma entrada no LOG com nível INFO.
     * @param {string} funcao - Nome da função que gerou o log
     * @param {string} mensagem - Mensagem descritiva
     */
    info(funcao, mensagem) {
        this._write(funcao, mensagem, 'INFO');
    }

    /**
     * Registra uma entrada no LOG com nível AVISO.
     * @param {string} funcao - Nome da função que gerou o log
     * @param {string} mensagem - Mensagem descritiva
     */
    warn(funcao, mensagem) {
        this._write(funcao, mensagem, 'AVISO');
    }

    /**
     * Registra uma entrada no LOG com nível ERRO.
     * @param {string} funcao - Nome da função que gerou o log
     * @param {string} mensagem - Mensagem descritiva
     */
    error(funcao, mensagem) {
        this._write(funcao, mensagem, 'ERRO');
    }

    /**
     * Garante que a aba LOG existe, criando-a se necessário.
     * A aba é criada oculta e protegida contra edição manual.
     *
     * 📋 FORMS: esta aba NÃO é vinculada a nenhum formulário.
     * É criada e gerenciada exclusivamente pelo script.
     *
     * @returns {GoogleAppsScript.Spreadsheet.Sheet}
     */
    ensureLogSheet() {
        const ss = this._ss.getActiveSpreadsheet();
        const logName = this._config.config.sheetLog;
        let logSheet = ss.getSheetByName(logName);

        if (!logSheet) {
            logSheet = ss.insertSheet(logName);
            logSheet.getRange(1, 1, 1, 4)
                .setValues([['Timestamp', 'Nível', 'Função', 'Mensagem']])
                .setFontWeight('bold');
            logSheet.setFrozenRows(1);
            logSheet.hideSheet();

            const protection = logSheet.protect();
            protection.setDescription('Velozz CRM — Log do sistema. Não editar manualmente.');
            protection.removeEditors(protection.getEditors());
            if (protection.canDomainEdit()) protection.setDomainEdit(false);
        }

        return logSheet;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PRIVADO
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Escreve uma linha na aba LOG.
     * @private
     * @param {string} funcao
     * @param {string} mensagem
     * @param {string} nivel - 'INFO' | 'AVISO' | 'ERRO'
     */
    _write(funcao, mensagem, nivel) {
        try {
            const logSheet = this.ensureLogSheet();
            logSheet.appendRow([new Date(), nivel, funcao, mensagem]);
        } catch (e) {
            // Falha silenciosa: o Logger nunca deve quebrar o fluxo principal
            console.error(`[VelozzCRM] Falha ao registrar log: ${e.message}`);
        }
    }
}