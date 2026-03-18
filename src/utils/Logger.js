/**
 * @fileoverview Sistema de log persistente (extraído do MÓDULO 4).
 */
class Logger {
  constructor(appConfig, spreadsheetApp) {
    this._config = appConfig;
    this._ss = spreadsheetApp || SpreadsheetApp;
  }

  info(funcao, mensagem) {
    this._write(funcao, mensagem, 'INFO');
  }

  warn(funcao, mensagem) {
    this._write(funcao, mensagem, 'AVISO');
  }

  error(funcao, mensagem) {
    this._write(funcao, mensagem, 'ERRO');
  }

  _garantirAbaLog() {
    const ss = this._ss.getActiveSpreadsheet();
    const logName = this._config.getLogSheetName();
    let logSheet = ss.getSheetByName(logName);

    if (!logSheet) {
      logSheet = ss.insertSheet(logName);
      logSheet.getRange(1, 1, 1, 4)
          .setValues([['Timestamp', 'Nível', 'Função', 'Mensagem']])
          .setFontWeight('bold');
      logSheet.setFrozenRows(1);
      logSheet.hideSheet();

      const protection = logSheet.protect();
      protection.setDescription('Log do sistema — não editar manualmente');
      protection.removeEditors(protection.getEditors());
      if (protection.canDomainEdit()) protection.setDomainEdit(false);
    }
    return logSheet;
  }

  _write(funcao, mensagem, nivel) {
    try {
      this._garantirAbaLog().appendRow([new Date(), nivel, funcao, mensagem]);
    } catch (e) {
      console.error('Falha ao registrar log: ' + e.message);
    }
  }
}

if (typeof module !== 'undefined') {
  module.exports = Logger;
}
