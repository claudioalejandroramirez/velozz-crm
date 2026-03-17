/**
 * @fileoverview Orquestrador dos fluxos de sincronização bidirecional.
 *
 * DECISÃO DE ARQUITETURA — POR QUE ESTE ARQUIVO EXISTE:
 * TriggerHandlers.js deve conter APENAS as funções globais exigidas pelo
 * GAS (onOpen, onEdit, onFormSubmit). Toda lógica de negócio que antes
 * estava em syncPlanilhaParaContatos() e syncContatosParaPlanilha() foi
 * movida para cá, onde pode ser testada sem depender de triggers reais.
 *
 * FLUXO A — processarNovoContato():
 *   Forms → Sheets (já feito pelo Forms) → Contacts
 *   Deduplicação + criação de contato + tags PF/PJ + alerta se DOC inválido
 *
 * FLUXO B — syncPlanilhaParaContatos():
 *   onEdit → detectar mudança → atualizar Contacts
 *   Tags temporárias se telefone ou email mudou
 *
 * FLUXO C — syncContatosParaPlanilha():
 *   time-based → buscar contatos alterados → atualizar planilha
 *   Correção de DOC pelo operador + tags temporárias
 *
 * ⚠️ GAS RUNTIME: todos os métodos públicos devem ser chamados dentro
 * de LockManager.withLock() quando houver risco de execução paralela.
 * O lock é aplicado em TriggerHandlers, não aqui — SyncOrchestrator
 * não tem conhecimento de concorrência (Single Responsibility).
 */
class SyncOrchestrator {
  /**
     * @param {AppConfig} appConfig
     * @param {Logger} logger
     * @param {SheetService} sheetService
     * @param {FormService} formService
     * @param {ContactService} contactService
     * @param {TagService} tagService
     * @param {DocumentValidator} validator
     * @param {Formatter} formatter
     */
  constructor(
      appConfig, logger, sheetService, formService,
      contactService, tagService, validator, formatter,
  ) {
    this._config = appConfig;
    this._logger = logger;
    this._sheets = sheetService;
    this._forms = formService;
    this._contacts = contactService;
    this._tags = tagService;
    this._validator = validator;
    this._formatter = formatter;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // FLUXO A: FORMS → SHEETS → CONTACTS (onFormSubmit)
  // ═══════════════════════════════════════════════════════════════════════

  /**
     * Processa uma nova resposta de formulário.
     * 1. Valida a estrutura do evento
     * 2. Verifica duplicidade por DOC
     * 3. Cria o contato no Google Contacts
     * 4. Aplica tags e envia alerta se DOC inválido
     *
     * 📋 FORMS: e.namedValues é a fonte primária de dados.
     * A aba de destino já recebeu a linha do Forms antes deste método
     * ser chamado — o script apenas COMPLEMENTA com Status, ResourceName
     * e Última Atualização.
     *
     * @param {Object} formEvent - Evento onFormSubmit (e)
     * @param {'PF'|'PJ'} tipo - Tipo identificado da resposta
     * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet - Aba de destino
     * @param {number} newRow - Número da linha recém-inserida pelo Forms
     */
  processNewContact(formEvent, tipo, sheet, newRow) {
    const headers = this._config.config.headers;

    // 1. Valida estrutura do evento antes de qualquer chamada à API
    const {valid, missingKeys} = this._forms.validateFormEvent(formEvent, tipo);
    if (!valid) {
      this._sheets.setCellByHeader(
          sheet, newRow, headers.status,
          `Erro: campos ausentes no formulário [${missingKeys.join(', ')}]`,
      );
      return;
    }

    const dados = this._forms.extractFormData(formEvent, tipo);
    const docHeader = tipo === 'PF' ? headers.docPF : headers.docPJ;

    // 2. Deduplicação por DOC
    if (dados.documentoLimpo) {
      const {found, row: dupRow} = this._sheets.findDuplicateDoc(
          sheet, dados.documentoLimpo, docHeader,
      );
      // Ignora a própria linha recém-inserida pelo Forms
      if (found && dupRow !== newRow) {
        this._sheets.setCellByHeader(
            sheet, newRow, headers.status,
            `Duplicado: DOC já cadastrado na linha ${dupRow}`,
        );
        this._logger.warn(
            'SyncOrchestrator.processNewContact',
            `Duplicado: ${dados.documentoLimpo} já existe na linha ${dupRow}`,
        );
        return;
      }
    }

    // 3. Marca como "Processando..." antes de chamar a API (feedback imediato)
    this._sheets.setCellByHeader(sheet, newRow, headers.status, 'Processando...');

    try {
      const payload = this._forms.buildContactPayload(dados);
      const newContact = this._contacts.create(payload);
      const resourceName = newContact.resourceName;

      // 4. Tags: PF/PJ obrigatória + 'revisar' se DOC inválido
      this._tags.apply(resourceName, tipo);
      if (!dados.isValid && dados.documentoLimpo) {
        this._tags.apply(resourceName, this._config.config.tagAlertName);
        this._sendInvalidDocAlert(dados);
      }

      // Escreve colunas do script (não existem no Forms)
      this._sheets.setCellByHeader(
          sheet, newRow, headers.resourceName, resourceName,
      );
      this._sheets.setCellByHeader(
          sheet, newRow, headers.ultimaAtualizacao, new Date(),
      );
      this._sheets.setCellByHeader(
          sheet, newRow, headers.status,
                dados.isValid ? 'Sincronizado' : 'Sincronizado (Alerta: DOC Inválido)',
      );

      this._logger.info(
          'SyncOrchestrator.processNewContact',
          `Contato criado: ${dados.nome} | DOC: ${dados.documentoLimpo} | ` +
                `Válido: ${dados.isValid} | ResourceName: ${resourceName}`,
      );
    } catch (error) {
      this._sheets.setCellByHeader(
          sheet, newRow, headers.status, `Erro API: ${error.message}`,
      );
      this._logger.error(
          'SyncOrchestrator.processNewContact',
          `Erro ao criar contato: ${error.message}`,
      );
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // FLUXO B: SHEETS → CONTACTS (onEdit)
  // ═══════════════════════════════════════════════════════════════════════

  /**
     * Sincroniza uma edição na planilha para o Google Contacts.
     * Detecta mudanças de telefone e email para aplicar tags temporárias.
     *
     * ⚠️ BUG FIX (original): este método só é chamado se a coluna editada
     * for menor que COLUNA_RESOURCE — prevenindo o loop de sync.
     * Esse filtro é aplicado em TriggerHandlers antes de chamar este método.
     *
     * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet - Aba editada
     * @param {number} row - Linha editada
     * @param {'PF'|'PJ'} tipo - Tipo da aba
     * @param {string} resourceName - ID do contato na linha
     */
  syncSheetToContacts(sheet, row, tipo, resourceName) {
    const headers = this._config.config.headers;
    const statusExtras = [];

    try {
      // Busca contato atual para comparação de tel/email e etag
      const currentContact = this._contacts.get(resourceName);
      const dados = this._forms.extractRowData(sheet, row, tipo);

      // ── Detecção de mudança de telefone ──────────────────────────────
      const phoneInContacts = this._contacts.extractPhone(currentContact);
      if (TagService.phoneChanged(dados.telefoneLimpo, phoneInContacts)) {
        this._tags.applyTemporary(
            resourceName, this._config.config.tagPhoneName,
        );
        statusExtras.push('📞 novo-telefone');
        this._logger.info(
            'SyncOrchestrator.syncSheetToContacts',
            `Telefone alterado linha ${row}: ${phoneInContacts} → ${dados.telefoneLimpo}`,
        );
      }

      // ── Detecção de mudança de email ──────────────────────────────────
      const emailInContacts = this._contacts.extractEmail(currentContact);
      if (TagService.emailChanged(dados.email, emailInContacts)) {
        this._tags.applyTemporary(
            resourceName, this._config.config.tagEmailName,
        );
        statusExtras.push('✉️ novo-email');
        this._logger.info(
            'SyncOrchestrator.syncSheetToContacts',
            `Email alterado linha ${row}: ${emailInContacts} → ${dados.email}`,
        );
      }

      // ── Atualiza o contato ────────────────────────────────────────────
      const payload = this._forms.buildContactPayload(dados);
      payload.etag = currentContact.etag;
      this._contacts.update(payload, resourceName);

      // Remove tag 'revisar' se DOC agora é válido
      if (dados.isValid) {
        this._tags.remove(resourceName, this._config.config.tagAlertName);
      }

      // Atualiza colunas do script
      this._sheets.setCellByHeader(
          sheet, row, headers.ultimaAtualizacao, new Date(),
      );
      const statusMsg = statusExtras.length > 0 ?
                `Edição Sincronizada (Planilha → Contacts) | ${statusExtras.join(' | ')}` :
                'Edição Sincronizada (Planilha → Contacts)';
      this._sheets.setCellByHeader(sheet, row, headers.status, statusMsg);

      this._logger.info(
          'SyncOrchestrator.syncSheetToContacts',
          `Linha ${row} → Contacts OK. ${statusExtras.join(', ') || 'Sem mudanças de contato'}`,
      );
    } catch (error) {
      this._sheets.setCellByHeader(
          sheet, row, headers.status, `Erro Sync: ${error.message}`,
      );
      this._logger.error(
          'SyncOrchestrator.syncSheetToContacts',
          `Erro na linha ${row}: ${error.message}`,
      );
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // FLUXO C: CONTACTS → SHEETS (time-based)
  // ═══════════════════════════════════════════════════════════════════════

  /**
     * Processa todos os contatos alterados desde o último sync.
     * Para cada contato alterado:
     *   A. Processa DOC (correção do operador ou normalização)
     *   B. Detecta mudança de telefone
     *   C. Detecta mudança de email
     *
     * @return {number} Quantidade de contatos processados
     */
  syncContactsToSheet() {
    const {isFirstRun, connections} = this._contacts.getModifiedContacts();
    if (isFirstRun || connections.length === 0) return 0;

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let processed = 0;

    connections.forEach((contact) => {
      try {
        this._processSingleContactSync(contact, ss);
        processed++;
      } catch (error) {
        this._logger.error(
            'SyncOrchestrator.syncContactsToSheet',
            `Erro ao processar ${contact.resourceName}: ${error.message}`,
        );
      }
    });

    return processed;
  }

  // ─────────────────────────────────────────────────────────────────────
  // PRIVADO
  // ─────────────────────────────────────────────────────────────────────

  /**
     * Processa a sincronização de um único contato alterado.
     * @private
     * @param {Object} contact - Objeto contato da People API
     * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} ss
     */
  _processSingleContactSync(contact, ss) {
    const resourceName = contact.resourceName;
    const headers = this._config.config.headers;

    // Localiza a linha do contato nas abas PF e PJ
    const {sheet, row} = this._findContactRow(resourceName, ss);
    if (!sheet || !row) return; // Contato não pertence ao sistema

    const tipo = sheet.getName() === this._config.config.sheetPF ? 'PF' : 'PJ';
    const mudancas = [];

    // ── PASSO A: DOC (campo biography) ───────────────────────────────────
    const bio = this._contacts.extractBiography(contact);
    if (bio) {
      this._processBiographySync(contact, sheet, row, tipo, bio, mudancas);
    }

    // ── PASSO B: Telefone ─────────────────────────────────────────────────
    const phoneInSheet = (
      this._sheets.getCellByHeader(sheet, row, headers.telefone) || ''
    ).toString().replace(/\D/g, '');
    const phoneInContacts = this._contacts.extractPhone(contact);

    if (TagService.phoneChanged(phoneInSheet, phoneInContacts)) {
      this._sheets.setCellByHeader(
          sheet, row, headers.telefone,
          this._formatter.phone(phoneInContacts),
      );
      this._tags.applyTemporary(resourceName, this._config.config.tagPhoneName);
      mudancas.push('📞 Telefone Atualizado');
      this._logger.info(
          'SyncOrchestrator._processSingleContactSync',
          `Telefone: ${resourceName} | ${phoneInSheet} → ${phoneInContacts}`,
      );
    }

    // ── PASSO C: Email ────────────────────────────────────────────────────
    const emailInSheet = (
      this._sheets.getCellByHeader(sheet, row, headers.email) || ''
    ).toString().toLowerCase().trim();
    const emailInContacts = this._contacts.extractEmail(contact);

    if (TagService.emailChanged(emailInSheet, emailInContacts)) {
      this._sheets.setCellByHeader(sheet, row, headers.email, emailInContacts);
      this._tags.applyTemporary(resourceName, this._config.config.tagEmailName);
      mudancas.push('✉️ Email Atualizado');
      this._logger.info(
          'SyncOrchestrator._processSingleContactSync',
          `Email: ${resourceName} | ${emailInSheet} → ${emailInContacts}`,
      );
    }

    // Atualiza status e timestamp apenas se houve mudança real
    if (mudancas.length > 0) {
      this._sheets.setCellByHeader(
          sheet, row, headers.status,
          `${mudancas.join(' | ')} (Contacts → Planilha)`,
      );
      this._sheets.setCellByHeader(
          sheet, row, headers.ultimaAtualizacao, new Date(),
      );
    }
  }

  /**
     * Processa o campo biography de um contato alterado.
     * Detecta se é correção do operador (só dígitos) ou sync normal.
     * @private
     */
  _processBiographySync(contact, sheet, row, tipo, bio, mudancas) {
    const headers = this._config.config.headers;
    const docHeader = tipo === 'PF' ?
            headers.docPF :
            headers.docPJ;

    // Correção do operador: campo contém apenas dígitos sem prefixo
    if (this._validator.isOperatorCorrection(bio)) {
      const result = this._validator.identify(bio);

      if (result.valid) {
        // ✅ DOC válido após correção
        const formatted = this._formatter.document(result.digits, result.type);

        this._sheets.setCellByHeader(
            sheet, row, docHeader, result.digits, true, // forceText: preserva zero
        );
        this._contacts.updateBiography(
            contact.resourceName,
            contact.etag,
            `${result.type}: ${formatted}`,
        );
        this._tags.remove(contact.resourceName, this._config.config.tagAlertName);
        mudancas.push('✅ Corrigido pelo Operador');
        this._sheets.setCellByHeader(
            sheet, row, headers.status, 'Corrigido pelo Operador',
        );
        this._logger.info(
            'SyncOrchestrator._processBiographySync',
            `DOC corrigido: ${contact.resourceName} → ${formatted}`,
        );
      } else {
        // ⚠️ Operador digitou número mas ainda inválido matematicamente
        const inferredType = result.digits.length === 11 ? 'CPF' : 'CNPJ';
        this._contacts.updateBiography(
            contact.resourceName,
            contact.etag,
            `${inferredType}: ${result.digits} [INVÁLIDO]`,
        );
        this._tags.apply(contact.resourceName, this._config.config.tagAlertName);
        this._sendInvalidDocAlert({
          nome: this._contacts.extractFullName(contact),
          docTipo: inferredType,
          documentoLimpo: result.digits,
          telefoneLimpo: '',
          email: '',
        });
        mudancas.push('⚠️ Correção Falhou: DOC ainda inválido');
        this._sheets.setCellByHeader(
            sheet, row, headers.status,
            'Correção Falhou: DOC ainda inválido',
        );
        this._logger.warn(
            'SyncOrchestrator._processBiographySync',
            `Correção falhou: ${contact.resourceName} → ${result.digits}`,
        );
      }
    } else {
      // Sync normal: biography já tem prefixo "CPF:" ou "CNPJ:"
      const result = this._validator.identify(bio);
      if (result.valid) {
        const formatted = this._formatter.document(result.digits, result.type);
        // BUG FIX: forceText=true preserva zeros à esquerda (CPF 086...)
        this._sheets.setCellByHeader(
            sheet, row, docHeader, result.digits, true,
        );
        this._contacts.updateBiography(
            contact.resourceName,
            contact.etag,
            `${result.type}: ${formatted}`,
        );
        this._tags.remove(contact.resourceName, this._config.config.tagAlertName);
        mudancas.push('DOC sincronizado');
        this._logger.info(
            'SyncOrchestrator._processBiographySync',
            `DOC normalizado: ${contact.resourceName} → ${formatted}`,
        );
      }
    }
  }

  /**
     * Localiza a linha de um contato pelo resourceName nas abas PF e PJ.
     * @private
     * @param {string} resourceName
     * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} ss
     * @returns {{ sheet: Sheet|null, row: number|null }}
     */
  _findContactRow(resourceName, ss) {
    const sheetNames = [
      this._config.config.sheetPF,
      this._config.config.sheetPJ,
    ];

    for (const name of sheetNames) {
      const sheet = ss.getSheetByName(name);
      if (!sheet) continue;
      const row = this._sheets.findRowByResourceName(sheet, resourceName);
      if (row) return {sheet, row};
    }

    return {sheet: null, row: null};
  }

  /**
     * Envia e-mail de alerta para DOC inválido.
     * @private
     * @param {Object} dados - Dados do contato com DOC inválido
     */
  _sendInvalidDocAlert(dados) {
    try {
      const alertEmail = this._config.config.alertEmail;
      const subject =
                `⚠️ [${this._config.config.companyName}] Lead Inválido: ` +
                `Revisar ${dados.docTipo} de ${dados.nome}`;
      const body =
                `O cliente ${dados.nome} possui um ${dados.docTipo} inválido.\n\n` +
                `DOC Informado: ${dados.documentoLimpo || 'Vazio'}\n` +
                `Telefone: ${this._formatter.phone(dados.telefoneLimpo) || 'Não informado'}\n` +
                `E-mail: ${dados.email || 'Não informado'}\n\n` +
                `O contato está com a tag '${this._config.config.tagAlertName}' ` +
                `no Google Contacts.\n\n` +
                `— Velozz CRM`;
      MailApp.sendEmail(alertEmail, subject, body);
    } catch (e) {
      this._logger.error(
          'SyncOrchestrator._sendInvalidDocAlert',
          `Falha ao enviar e-mail de alerta: ${e.message}`,
      );
    }
  }
}
