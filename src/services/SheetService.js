/**
 * @fileoverview Serviço para interação com as abas PF e PJ.
 */
class SheetService {
  constructor(appConfig, logger, spreadsheetApp) {
    this._config = appConfig;
    this._logger = logger;
    this._ss = spreadsheetApp || SpreadsheetApp;
  }

  getSheetPF() {
    return this._ss.getActiveSpreadsheet().getSheetByName(this._config.getPfSheetName());
  }

  getSheetPJ() {
    return this._ss.getActiveSpreadsheet().getSheetByName(this._config.getPjSheetName());
  }

  getSheetLOG() {
    return this._ss.getActiveSpreadsheet().getSheetByName(this._config.getLogSheetName());
  }

  getSheetRespostas() {
    return this._ss.getActiveSpreadsheet().getSheetByName(this._config.getRespostasSheetName());
  }

  // Escreve uma nova linha na aba de destino (PF ou PJ) com base nos dados extraídos.
  // Corresponde à lógica de escrita de linha em processarFormulario (MÓDULO 5).
  escreverNovaLinha(sheet, dados, tipo, statusInicial = 'Processando...') {
    const timestamp = new Date();
    const config = this._config.config;
    let linhaArray;

    if (tipo === 'Pessoa Física') {
      linhaArray = [
        timestamp, dados.nome, dados.sobrenome, dados.documentoLimpo,
        dados.logradouro, dados.numero, dados.complemento,
        dados.telefoneLimpo, dados.email,
        statusInicial, '', '',
      ];
    } else { // Pessoa Jurídica
      linhaArray = [
        timestamp, dados.nome, dados.empresa, dados.documentoLimpo,
        dados.logradouro, dados.numero, dados.complemento,
        dados.telefoneLimpo, dados.email,
        statusInicial, '', '',
      ];
    }

    const novaLinha = sheet.getLastRow() + 1;
    sheet.getRange(novaLinha, 1, 1, linhaArray.length).setValues([linhaArray]);
    return novaLinha;
  }

  // Atualiza o status de uma linha.
  setStatus(sheet, row, status) {
    sheet.getRange(row, this._config.config.colunaStatus).setValue(status);
  }

  // Atualiza o ResourceName de uma linha.
  setResourceName(sheet, row, resourceName) {
    sheet.getRange(row, this._config.config.colunaResource).setValue(resourceName);
  }

  // Atualiza o timestamp de sync de uma linha.
  setSyncTimestamp(sheet, row) {
    sheet.getRange(row, this._config.config.colunaSync).setValue(new Date());
  }

  // Obtém o ResourceName de uma linha.
  getResourceName(sheet, row) {
    return sheet.getRange(row, this._config.config.colunaResource).getValue();
  }

  // Obtém os valores de uma linha (da coluna 1 até a coluna de Status-1).
  getDadosLinha(sheet, row) {
    return sheet.getRange(row, 1, 1, this._config.config.colunaStatus - 1).getValues()[0];
  }

  // Obtém o documento (CPF/CNPJ) de uma linha, já limpando os dígitos.
  getDocLinha(sheet, row) {
    const doc = sheet.getRange(row, this._config.config.colunaDoc).getValue();
    return (doc || '').toString().replace(/\D/g, '');
  }

  // Obtém o telefone de uma linha, já limpando os dígitos.
  getTelefoneLinha(sheet, row) {
    const tel = sheet.getRange(row, this._config.config.colunaTelefone).getValue();
    return (tel || '').toString().replace(/\D/g, '');
  }

  // Obtém o email de uma linha.
  getEmailLinha(sheet, row) {
    return sheet.getRange(row, this._config.config.colunaEmail).getValue();
  }

  // Define o telefone em uma linha.
  setTelefoneLinha(sheet, row, telefone) {
    sheet.getRange(row, this._config.config.colunaTelefone).setValue(telefone);
  }

  // Define o email em uma linha.
  setEmailLinha(sheet, row, email) {
    sheet.getRange(row, this._config.config.colunaEmail).setValue(email);
  }

  // Define o documento em uma linha, com formatação de texto para preservar zeros.
  setDocLinha(sheet, row, doc) {
    sheet.getRange(row, this._config.config.colunaDoc)
        .setNumberFormat('@STRING@').setValue(doc);
  }

  // Verifica duplicidade de DOC. Retorna { encontrado: boolean, linha: number|null }.
  // Extraído da lógica de deduplicação do MÓDULO 5.
  verificarDuplicidadeDoc(sheet, docLimpo) {
    const ultimaLinha = sheet.getLastRow();
    if (ultimaLinha <= 1) return {encontrado: false, linha: null};

    const colunaDoc = sheet.getRange(2, this._config.config.colunaDoc, ultimaLinha - 1, 1).getValues();
    for (let i = 0; i < colunaDoc.length; i++) {
      const docExistente = (colunaDoc[i][0] || '').toString().replace(/\D/g, '');
      if (docExistente === docLimpo) {
        return {encontrado: true, linha: i + 2};
      }
    }
    return {encontrado: false, linha: null};
  }

  // Encontra a linha de um contato pelo ResourceName.
  // Extraído da lógica de localização em syncContatosParaPlanilha (MÓDULO 7).
  encontrarLinhaPorResourceName(resourceName) {
    const ss = this._ss.getActiveSpreadsheet();
    const abas = [this.getSheetPF(), this.getSheetPJ()];

    for (const sheet of abas) {
      if (!sheet) continue;
      const finder = sheet.getRange(1, this._config.config.colunaResource, sheet.getMaxRows(), 1)
          .createTextFinder(resourceName).matchEntireCell(true).findNext();
      if (finder) {
        return {sheet, row: finder.getRow()};
      }
    }
    return {sheet: null, row: null};
  }

  // Configura a planilha (Setup Inicial) - extraído do MÓDULO 3.
  setupInicial() {
    const ss = this._ss.getActiveSpreadsheet();
    const cfg = this._config.config;
    const cabecalhoPF = [
      'Data', 'Nome', 'Sobrenome', 'CPF', 'Endereço', 'Número',
      'Complemento', 'Telefone', 'Email', 'Status', 'ResourceName', 'Última Atualização',
    ];
    const cabecalhoPJ = [
      'Data', 'Nome Responsável', 'Empresa', 'CNPJ', 'Endereço', 'Número',
      'Complemento', 'Telefone', 'Email', 'Status', 'ResourceName', 'Última Atualização',
    ];

    [{nome: cfg.abaPF, cab: cabecalhoPF}, {nome: cfg.abaPJ, cab: cabecalhoPJ}]
        .forEach(({nome, cab}) => {
          let sheet = ss.getSheetByName(nome);
          if (!sheet) sheet = ss.insertSheet(nome);
          sheet.getRange(1, 1, 1, cab.length).setValues([cab]).setFontWeight('bold');
          sheet.setFrozenRows(1);
          sheet.hideColumns(cfg.colunaResource, 2);

          const protecao = sheet.getRange(1, cfg.colunaResource, sheet.getMaxRows(), 2).protect();
          protecao.setDescription('Gerenciado pelo script — não editar');
          protecao.removeEditors(protecao.getEditors());
          if (protecao.canDomainEdit()) protecao.setDomainEdit(false);
        });

    this._logger.info('setupInicial', 'Setup executado com sucesso.');
  }
}

if (typeof module !== 'undefined') {
  module.exports = SheetService;
}
