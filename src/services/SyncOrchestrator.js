/**
 * @fileoverview Orquestrador dos fluxos de sincronização.
 * Centraliza a lógica de negócio dos MÓDULOS 5, 6 e 7.
 */
class SyncOrchestrator {
  constructor(appConfig, logger, sheetService, formService, contactService, tagService, validator, formatter) {
    this._config = appConfig;
    this._logger = logger;
    this._sheets = sheetService;
    this._forms = formService;
    this._contacts = contactService;
    this._tags = tagService;
    this._validator = validator;
    this._formatter = formatter;
  }

  // --- FLUXO: Forms → Sheets → Contacts (MÓDULO 5) ---
  processarNovoContato(e, tipo) {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const valores = e.values;
    const sheetDestino = tipo === 'Pessoa Física' ? this._sheets.getSheetPF() : this._sheets.getSheetPJ();

    if (!sheetDestino) {
      this._logger.error('SyncOrchestrator.processarNovoContato', `Aba destino para ${tipo} não encontrada.`);
      return;
    }

    const dados = this._forms.extrairDadosFormulario(valores, tipo);

    // 1. Deduplicação
    if (dados.documentoLimpo) {
      const duplicado = this._sheets.verificarDuplicidadeDoc(sheetDestino, dados.documentoLimpo);
      if (duplicado.encontrado) {
        const statusDuplicado = `Duplicado: DOC já cadastrado na linha ${duplicado.linha}`;
        this._sheets.escreverNovaLinha(sheetDestino, dados, tipo, statusDuplicado);
        this._logger.warn('SyncOrchestrator.processarNovoContato',
          `Duplicado: ${dados.documentoLimpo} já existe na linha ${duplicado.linha}`);
        return;
      }
    }

    // 2. Escreve linha com status "Processando..."
    const novaLinha = this._sheets.escreverNovaLinha(sheetDestino, dados, tipo, 'Processando...');
    const statusCell = sheetDestino.getRange(novaLinha, this._config.config.colunaStatus);

    // 3. Cria contato
    try {
      const payload = this._forms.montarObjetoPessoa(dados);
      const novoContato = this._contacts.createContact(payload);
      const resourceName = novoContato.resourceName;

      // 4. Aplica tags
      this._contacts.aplicarTag(resourceName, tipo === 'Pessoa Física' ? 'PF' : 'PJ');
      if (!dados.isValid && dados.documentoLimpo) {
        this._contacts.aplicarTag(resourceName, this._config.getTagAlerta());
        this._enviarAlertaEmail(dados);
      }

      // 5. Atualiza planilha
      this._sheets.setResourceName(sheetDestino, novaLinha, resourceName);
      this._sheets.setSyncTimestamp(sheetDestino, novaLinha);
      const statusFinal = dados.isValid ? 'Sincronizado' : 'Sincronizado (Alerta: DOC Inválido)';
      this._sheets.setStatus(sheetDestino, novaLinha, statusFinal);

      this._logger.info('SyncOrchestrator.processarNovoContato',
        `Contato criado: ${dados.nome} | DOC: ${dados.documentoLimpo} | Válido: ${dados.isValid}`);
    } catch (error) {
      this._sheets.setStatus(sheetDestino, novaLinha, 'Erro API: ' + error.message);
      this._logger.error('SyncOrchestrator.processarNovoContato', 'Erro API: ' + error.message);
    }
  }

  // --- FLUXO: Sheets → Contacts (onEdit - MÓDULO 6) ---
  syncPlanilhaParaContatos(e) {
    if (!e || !e.range) return;

    const sheet = e.range.getSheet();
    const sheetName = sheet.getName();
    const cfg = this._config.config;
    if (sheetName !== cfg.abaPF && sheetName !== cfg.abaPJ) return;

    const row = e.range.getRow();
    if (row === 1) return;

    // BUG 2 FIX: bloqueia loop quando o próprio script edita colunas gerenciadas.
    const col = e.range.getColumn();
    if (col >= cfg.colunaResource) return;

    const resourceName = this._sheets.getResourceName(sheet, row);
    if (!resourceName) return;

    try {
      // Busca contato atual e dados da linha
      const contatoAtual = this._contacts.getContact(resourceName);
      const valoresLinha = this._sheets.getDadosLinha(sheet, row);
      const tipo = sheetName === cfg.abaPF ? 'Pessoa Física' : 'Pessoa Jurídica';

      // Reconstrói objeto 'dados' para ter a mesma estrutura do FormService
      const dados = this._reconstruirDadosDeLinha(valoresLinha, tipo);
      dados.documentoLimpo = this._sheets.getDocLinha(sheet, row);
      dados.isValid = (tipo === 'Pessoa Física')
        ? this._validator.validarCPF(dados.documentoLimpo)
        : this._validator.validarCNPJ(dados.documentoLimpo);

      const statusExtras = [];

      // Detecção de mudança de telefone
      const telNoContato = this._formatter.apenasDigitos(contatoAtual.phoneNumbers?.[0]?.value);
      if (telNoContato && dados.telefoneLimpo && telNoContato !== dados.telefoneLimpo) {
        this._tags.aplicarTagTemporaria(resourceName, this._config.getTagNovoTelefone());
        statusExtras.push('📞 novo-telefone');
        this._logger.info('SyncOrchestrator.syncPlanilhaParaContatos',
          `Telefone alterado linha ${row}: ${telNoContato} → ${dados.telefoneLimpo}`);
      }

      // Detecção de mudança de email
      const emailNoContato = this._formatter.normalizarEmail(contatoAtual.emailAddresses?.[0]?.value);
      if (emailNoContato && dados.email && emailNoContato !== dados.email) {
        this._tags.aplicarTagTemporaria(resourceName, this._config.getTagNovoEmail());
        statusExtras.push('✉️ novo-email');
        this._logger.info('SyncOrchestrator.syncPlanilhaParaContatos',
          `Email alterado linha ${row}: ${emailNoContato} → ${dados.email}`);
      }

      // Atualiza contato
      const payload = this._forms.montarObjetoPessoa(dados);
      payload.etag = contatoAtual.etag;
      this._contacts.updateContact(payload, resourceName);

      if (dados.isValid) {
        this._contacts.removerTag(resourceName, this._config.getTagAlerta());
      }

      // Atualiza planilha
      this._sheets.setSyncTimestamp(sheet, row);
      const statusFinal = statusExtras.length > 0
        ? `Edição Sincronizada (Planilha → Contacts) | ${statusExtras.join(' | ')}`
        : 'Edição Sincronizada (Planilha → Contacts)';
      this._sheets.setStatus(sheet, row, statusFinal);

      this._logger.info('SyncOrchestrator.syncPlanilhaParaContatos',
        `Linha ${row} sincronizada. ${statusExtras.join(', ')}`);
    } catch (error) {
      this._sheets.setStatus(sheet, row, 'Erro Sync: ' + error.message);
      this._logger.error('SyncOrchestrator.syncPlanilhaParaContatos', `Erro na linha ${row}: ${error.message}`);
    }
  }

  // --- FLUXO: Contacts → Sheets (time-based - MÓDULO 7) ---
  syncContatosParaPlanilha() {
    const syncToken = this._contacts.getSyncToken();
    let processedCount = 0;

    try {
      const response = this._contacts.listConnections(syncToken);
      if (response.nextSyncToken) {
        this._contacts.setSyncToken(response.nextSyncToken);
      }

      if (!syncToken) {
        this._logger.info('SyncOrchestrator.syncContatosParaPlanilha', 'Primeira execução: Sync Token gerado.');
        return 0;
      }
      if (!response.connections || response.connections.length === 0) return 0;

      response.connections.forEach(contato => {
        const { sheet, row } = this._sheets.encontrarLinhaPorResourceName(contato.resourceName);
        if (!sheet || !row) return; // Contato não pertence ao sistema

        const mudancas = [];
        const resourceName = contato.resourceName;
        const cfg = this._config.config;

        // --- Processar DOC (Biography) ---
        const noteAtual = contato.biographies?.[0]?.value?.trim() || '';
        if (noteAtual) {
          this._processarBiography(contato, sheet, row, noteAtual, mudancas);
        }

        // --- Detectar mudança de Telefone ---
        const telNaPlanilha = this._sheets.getTelefoneLinha(sheet, row);
        const telNoContato = this._formatter.apenasDigitos(contato.phoneNumbers?.[0]?.value);
        if (telNaPlanilha && telNoContato && telNaPlanilha !== telNoContato) {
          this._sheets.setTelefoneLinha(sheet, row, this._formatter.telefone(telNoContato));
          this._tags.aplicarTagTemporaria(resourceName, cfg.tagNovoTelefone);
          mudancas.push('📞 Telefone Atualizado');
          this._logger.info('SyncOrchestrator.syncContatosParaPlanilha',
            `Telefone: ${resourceName} | ${telNaPlanilha} → ${telNoContato}`);
        }

        // --- Detectar mudança de Email ---
        const emailNaPlanilha = this._formatter.normalizarEmail(this._sheets.getEmailLinha(sheet, row));
        const emailNoContato = this._formatter.normalizarEmail(contato.emailAddresses?.[0]?.value);
        if (emailNaPlanilha && emailNoContato && emailNaPlanilha !== emailNoContato) {
          this._sheets.setEmailLinha(sheet, row, contato.emailAddresses[0].value); // Usa o valor original
          this._tags.aplicarTagTemporaria(resourceName, cfg.tagNovoEmail);
          mudancas.push('✉️ Email Atualizado');
          this._logger.info('SyncOrchestrator.syncContatosParaPlanilha',
            `Email: ${resourceName} | ${emailNaPlanilha} → ${emailNoContato}`);
        }

        if (mudancas.length > 0) {
          this._sheets.setStatus(sheet, row, mudancas.join(' | ') + ' (Contacts → Planilha)');
          this._sheets.setSyncTimestamp(sheet, row);
          processedCount++;
        }
      });

    } catch (error) {
      this._logger.error('SyncOrchestrator.syncContatosParaPlanilha', 'Erro no Sync Reverso: ' + error.message);
    }
    return processedCount;
  }

  // --- Helpers Privados ---

  _reconstruirDadosDeLinha(valoresLinha, tipo) {
    // Esta função é um espelho de extrairDadosFormulario, mas para uma linha da planilha.
    // A ordem dos valoresLinha é: [Data, Nome, (Sobrenome|Empresa), Documento, Endereço, Número, Complemento, Telefone, Email]
    const dados = { tipo };
    if (tipo === 'Pessoa Física') {
      dados.nome = valoresLinha[1] || '';
      dados.sobrenome = valoresLinha[2] || '';
      dados.empresa = '';
      dados.docTipo = 'CPF';
    } else {
      dados.nome = valoresLinha[1] || ''; // Nome Responsável
      dados.sobrenome = ''; // Sobrenome não usado na PJ
      dados.empresa = valoresLinha[2] || '';
      dados.docTipo = 'CNPJ';
    }
    dados.logradouro = valoresLinha[4] || '';
    dados.numero = valoresLinha[5] || '';
    dados.complemento = valoresLinha[6] || '';
    dados.telefoneLimpo = this._formatter.apenasDigitos(valoresLinha[7]);
    dados.email = valoresLinha[8] || '';
    return dados;
  }

  _processarBiography(contato, sheet, row, noteAtual, mudancas) {
    const resourceName = contato.resourceName;
    const cfg = this._config.config;
    const docExtraido = this._formatter.apenasDigitos(noteAtual);
    const temPrefixo = /^(CPF|CNPJ)\s*:/i.test(noteAtual);
    const tamanhoValido = docExtraido.length === 11 || docExtraido.length === 14;

    // Modo Correção do Operador
    if (!temPrefixo && tamanhoValido) {
      let tipoDoc = null, isValido = false;
      if (this._validator.validarCPF(docExtraido)) { tipoDoc = 'CPF'; isValido = true; }
      else if (this._validator.validarCNPJ(docExtraido)) { tipoDoc = 'CNPJ'; isValido = true; }

      if (isValido) {
        const docFormatado = this._formatter.documento(docExtraido, tipoDoc);
        this._sheets.setDocLinha(sheet, row, docExtraido);
        this._contacts.updateBiography(resourceName, contato.etag, `${tipoDoc}: ${docFormatado}`);
        this._contacts.removerTag(resourceName, cfg.tagAlerta);
        mudancas.push('✅ Corrigido pelo Operador');
        this._logger.info('SyncOrchestrator._processarBiography',
          `DOC corrigido pelo operador: ${resourceName} → ${docFormatado}`);
      } else {
        const tipoInferido = docExtraido.length === 11 ? 'CPF' : 'CNPJ';
        this._contacts.updateBiography(resourceName, contato.etag, `${tipoInferido}: ${docExtraido} [INVÁLIDO]`);
        this._contacts.aplicarTag(resourceName, cfg.tagAlerta);
        this._enviarAlertaEmail({
          nome: contato.names?.[0] ? `${contato.names[0].givenName || ''} ${contato.names[0].familyName || ''}`.trim() : 'Desconhecido',
          docTipo: tipoInferido,
          documentoLimpo: docExtraido,
          telefoneLimpo: '',
          email: ''
        });
        mudancas.push('⚠️ Correção Falhou: DOC ainda inválido');
        this._logger.warn('SyncOrchestrator._processarBiography',
          `Correção falhou: ${resourceName} → ${docExtraido} inválido`);
      }
    } else {
      // Modo Normal: Extrai e valida DOC da biografia formatada
      let tipoDoc = null, isValido = false;
      if (this._validator.validarCPF(docExtraido)) { tipoDoc = 'CPF'; isValido = true; }
      else if (this._validator.validarCNPJ(docExtraido)) { tipoDoc = 'CNPJ'; isValido = true; }

      if (isValido) {
        const docFormatado = this._formatter.documento(docExtraido, tipoDoc);
        this._sheets.setDocLinha(sheet, row, docExtraido);
        this._contacts.updateBiography(resourceName, contato.etag, `${tipoDoc}: ${docFormatado}`);
        this._contacts.removerTag(resourceName, cfg.tagAlerta);
        mudancas.push('DOC sincronizado');
        this._logger.info('SyncOrchestrator._processarBiography',
          `DOC normalizado: ${resourceName} → ${docFormatado}`);
      }
    }
  }

  _enviarAlertaEmail(dados) {
    try {
      const meuEmail = Session.getEffectiveUser().getEmail();
      const assunto = `⚠️ Lead Inválido: Revisar DOC de ${dados.nome}`;
      const corpo =
        `O cliente ${dados.nome} possui um ${dados.docTipo} inválido (cadastro ou correção).\n\n` +
        `DOC Informado: ${dados.documentoLimpo || 'Vazio'}\n` +
        `Telefone: ${this._formatter.telefone(dados.telefoneLimpo) || 'Não informado'}\n` +
        `E-mail: ${dados.email || 'Não informado'}\n\n` +
        `O contato está com a tag '${this._config.getTagAlerta()}' no Google Contacts.`;
      MailApp.sendEmail(meuEmail, assunto, corpo);
    } catch (e) {
      this._logger.error('SyncOrchestrator._enviarAlertaEmail', `Falha ao enviar e-mail: ${e.message}`);
    }
  }
}

if (typeof module !== 'undefined') {
  module.exports = SyncOrchestrator;
}