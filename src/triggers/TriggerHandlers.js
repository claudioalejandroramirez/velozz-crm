/**
 * @fileoverview Funções globais exigidas pelo Google Apps Script.
 *
 * REGRA DE OURO DESTE ARQUIVO:
 * Cada função global deve ter NO MÁXIMO 10 linhas de lógica.
 * Toda lógica de negócio fica em SyncOrchestrator e nos serviços.
 * TriggerHandlers só faz: obter container → extrair contexto → delegar.
 *
 * ⚠️ GAS RUNTIME: funções globais não podem ser métodos de classe.
 * O GAS exige que onOpen, onEdit, onFormSubmit, etc. sejam funções
 * declaradas no escopo global. Por isso este arquivo existe separado.
 *
 * ⚠️ GAS RUNTIME: o objeto `e` em onEdit e onFormSubmit pode ser
 * undefined se a função for executada manualmente pelo editor do GAS.
 * Todos os handlers verificam `if (!e || !e.range)` antes de prosseguir.
 */

// ─────────────────────────────────────────────────────────────────────────────
// CONTAINER DE INJEÇÃO DE DEPENDÊNCIA
// Instanciado uma vez por execução. GAS não tem singleton entre execuções.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Monta e retorna o container com todas as dependências injetadas.
 * Centraliza a composição do sistema — único lugar onde `new` é chamado.
 *
 * DECISÃO: função em vez de módulo porque GAS V8 não suporta import/export.
 * O bundle.js garante que todas as classes estejam no escopo antes de Main.js.
 *
 * @returns {AppContainer}
 */
function _getContainer() {
    const appConfig = new AppConfig();
    const logger = new Logger(appConfig);
    const lockManager = new LockManager(appConfig, logger);
    const formatter = Formatter; // Classe estática — sem instanciação
    const validator = new DocumentValidator();
    const sheetService = new SheetService(appConfig, logger);
    const formService = new FormService(
        appConfig, logger, sheetService, validator, formatter
    );
    const tagService = new TagService(appConfig, logger);
    const contactService = new ContactService(appConfig, logger);
    const orchestrator = new SyncOrchestrator(
        appConfig, logger, sheetService, formService,
        contactService, tagService, validator, formatter
    );

    return {
        appConfig, logger, lockManager,
        formatter, validator,
        sheetService, formService, tagService, contactService,
        orchestrator,
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// TRIGGER 1: onOpen — Menu customizado
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Cria o menu "⚙️ Velozz CRM" ao abrir a planilha.
 * ⚠️ GAS RUNTIME: onOpen() simples não pode chamar serviços que requerem
 * autorização. Para dialogs que precisam de auth, usar onOpen com
 * trigger instalável (não simples). O menu em si não precisa de auth.
 */
function onOpen() {
    SpreadsheetApp.getUi()
        .createMenu('⚙️ Velozz CRM')
        .addItem('🚀 Configurar Tenant (Primeiro Acesso)', 'setupTenant')
        .addItem('⚙️ Executar Setup Inicial', 'setupInicial')
        .addSeparator()
        .addItem('🔄 Forçar Sync (Contacts → Planilha)', 'syncContatosParaPlanilha')
        .addItem('🔁 Resetar Sync Token', 'resetSyncToken')
        .addSeparator()
        .addItem('🏷️ Limpar Tags Expiradas', 'limparTagsExpiradas')
        .addSeparator()
        .addItem('📋 Ver LOG', 'verLog')
        .addToUi();
}

// ─────────────────────────────────────────────────────────────────────────────
// TRIGGER 2: onFormSubmit — Formulário enviado
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Disparado quando um Google Form envia uma resposta.
 * Identifica o tipo (PF/PJ) e delega para SyncOrchestrator.
 *
 * 📋 FORMS: o Google Forms já inseriu a linha na planilha antes deste
 * trigger ser chamado. `e.range` aponta para a linha recém-inserida.
 *
 * @param {Object} e - Evento onFormSubmit
 */
function processarFormulario(e) {
    if (!e || !e.namedValues) return;

    const { appConfig, orchestrator, lockManager, sheetService, logger } =
        _getContainer();

    const headers = appConfig.config.headers;
    const namedValues = e.namedValues;

    // Identifica o tipo pelo campo de roteamento configurado
    const tipoRaw = namedValues[headers.tipoPessoa];
    const tipoValor = tipoRaw ? tipoRaw[0] : '';

    let tipo;
    if (tipoValor === 'Pessoa Física') tipo = 'PF';
    else if (tipoValor === 'Pessoa Jurídica') tipo = 'PJ';
    else {
        logger.warn('processarFormulario', `Tipo desconhecido: "${tipoValor}"`);
        return;
    }

    const sheet = sheetService.getSheet(tipo);
    if (!sheet) {
        logger.error('processarFormulario', `Aba ${tipo} não encontrada.`);
        return;
    }

    // A linha recém-inserida pelo Forms é trazida no evento, ou fallback p/ última
    const newRow = (e && e.range) ? e.range.getRow() : sheet.getLastRow();

    lockManager.withLock(
        () => orchestrator.processNewContact(e, tipo, sheet, newRow),
        () => {
            sheetService.setCellByHeader(
                sheet, newRow, appConfig.config.headers.status,
                'Aguardando lock — tente novamente'
            );
        },
        `processarFormulario:${tipo}:linha${newRow}`
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// TRIGGER 3: onEdit — Edição na planilha
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Disparado ao editar qualquer célula nas abas PF ou PJ.
 * Guards de saída rápida evitam chamadas à API em edições irrelevantes.
 *
 * ⚠️ BUG FIX (loop de sync): o guard `editedCol >= resourceCol` impede
 * que edições do próprio script nas colunas K/L (ResourceName, Sync)
 * disparem o trigger novamente, criando um loop infinito.
 *
 * @param {Object} e - Evento onEdit
 */
function syncPlanilhaParaContatos(e) {
    if (!e || !e.range) return;

    const sheet = e.range.getSheet();
    const sheetName = sheet.getName();
    const row = e.range.getRow();
    const editedCol = e.range.getColumn();

    const { appConfig, orchestrator, lockManager, sheetService, logger } =
        _getContainer();

    const cfg = appConfig.config;

    // Guard 1: Apenas abas PF e PJ
    if (sheetName !== cfg.sheetPF && sheetName !== cfg.sheetPJ) return;

    // Guard 2: Ignora linha de cabeçalho
    if (row === 1) return;

    // Guard 3: BUG FIX — ignora colunas gerenciadas pelo script (K em diante)
    // Obtém índice da coluna ResourceName dinamicamente (sem hardcode)
    let resourceColIndex;
    try {
        resourceColIndex = sheetService.getColumnIndex(sheet, cfg.headers.resourceName);
    } catch (err) {
        // Coluna ainda não existe (antes do setupInicial) — ignora
        return;
    }
    if (editedCol >= resourceColIndex) return;

    // Guard 4: Linha precisa ter ResourceName (contato já criado no Contacts)
    const resourceName = sheetService.getCellByHeader(
        sheet, row, cfg.headers.resourceName
    );
    if (!resourceName) return;

    const tipo = sheetName === cfg.sheetPF ? 'PF' : 'PJ';

    lockManager.withLock(
        () => orchestrator.syncSheetToContacts(sheet, row, tipo, resourceName),
        () => {
            sheetService.setCellByHeader(
                sheet, row, cfg.headers.status, 'Aguardando lock — tente novamente'
            );
        },
        `syncPlanilhaParaContatos:${sheetName}:linha${row}`
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// TRIGGER 4: time-based (horário) — Contacts → Planilha
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Disparado pelo trigger time-based (a cada hora).
 * Busca contatos alterados no Google Contacts e sincroniza para a planilha.
 */
function syncContatosParaPlanilha() {
    const { orchestrator, logger } = _getContainer();
    try {
        const count = orchestrator.syncContactsToSheet();
        if (count > 0) {
            logger.info('syncContatosParaPlanilha', `${count} contato(s) sincronizado(s).`);
        }
    } catch (error) {
        logger.error('syncContatosParaPlanilha', `Erro geral: ${error.message}`);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// TRIGGER 5: time-based (diário) — Limpeza de tags expiradas
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Disparado diariamente às 3h pelo trigger criado em setupInicial().
 * Remove tags temporárias (novo-telefone, novo-email) expiradas.
 */
function limparTagsExpiradas() {
    const { tagService } = _getContainer();
    tagService.cleanExpired();
}

// ─────────────────────────────────────────────────────────────────────────────
// FUNÇÕES DO MENU — Chamadas pelo usuário via menu customizado
// ─────────────────────────────────────────────────────────────────────────────

/** Executa o setup inicial (cria LOG, proteções, trigger diário). */
function setupInicial() {
    const { appConfig, sheetService, logger } = _getContainer();
    const ui = SpreadsheetApp.getUi();
    const cfg = appConfig.config;
    const tipos = ['PF', 'PJ'];
    const errors = [];

    // Valida estrutura das abas antes de aplicar proteções
    tipos.forEach(tipo => {
        const sheet = sheetService.getSheet(tipo);
        if (!sheet) {
            errors.push(`Aba "${cfg['sheet' + tipo]}" não encontrada.`);
            return;
        }
        const { valid, missing } = sheetService.validateSheetStructure(sheet, tipo);
        if (!valid) {
            errors.push(
                `Aba ${tipo} — colunas não encontradas: [${missing.join(', ')}]. ` +
                `Verifique se o Google Forms está vinculado corretamente.`
            );
        }
    });

    if (errors.length > 0) {
        ui.alert(
            '❌ Setup interrompido\n\n' + errors.join('\n\n') +
            '\n\nDica: execute "Configurar Tenant" para ajustar os nomes das colunas.'
        );
        return;
    }

    // Adiciona colunas do script e aplica proteções
    tipos.forEach(tipo => {
        const sheet = sheetService.getSheet(tipo);
        sheetService.addScriptColumns(sheet);
        sheetService.protectColumnRange(
            sheet,
            cfg.headers.resourceName,
            cfg.headers.ultimaAtualizacao,
            'Velozz CRM — Gerenciado pelo script. Não editar manualmente.'
        );
        sheet.setFrozenRows(1);
        sheet.hideColumns(
            sheetService.getColumnIndex(sheet, cfg.headers.resourceName), 2
        );
    });

    // Garante aba LOG
    new Logger(appConfig).ensureLogSheet();

    // Cria trigger diário para limpeza de tags se não existir
    const triggers = ScriptApp.getProjectTriggers();
    const hasCleanupTrigger = triggers.some(
        t => t.getHandlerFunction() === 'limparTagsExpiradas'
    );
    if (!hasCleanupTrigger) {
        ScriptApp.newTrigger('limparTagsExpiradas')
            .timeBased().everyDays(1).atHour(cfg.syncHour).create();
        logger.info('setupInicial', `Trigger diário criado (${cfg.syncHour}h).`);
    }

    logger.info('setupInicial', 'Setup executado com sucesso.');
    ui.alert(
        '✅ Velozz CRM — Setup Concluído!\n\n' +
        '• Abas PF e PJ validadas e protegidas\n' +
        '• Aba LOG criada\n' +
        `• Trigger diário de limpeza configurado (${cfg.syncHour}h)\n\n` +
        'O sistema está pronto para uso.'
    );
}

/** Abre a aba LOG (tornando-a visível temporariamente). */
function verLog() {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const { appConfig } = _getContainer();
    const logSheet = ss.getSheetByName(appConfig.config.sheetLog);
    if (!logSheet) {
        SpreadsheetApp.getUi().alert(
            'Aba LOG não encontrada. Execute o Setup Inicial primeiro.'
        );
        return;
    }
    logSheet.showSheet();
    ss.setActiveSheet(logSheet);
}

/** Reseta o sync token para reprocessar todos os contatos no próximo ciclo. */
function resetSyncToken() {
    const { contactService } = _getContainer();
    contactService.resetSyncToken();
    SpreadsheetApp.getUi().alert(
        'ℹ️ Sync Token resetado.\n\nO próximo sync processará todos os contatos.'
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// SETUP TENANT — substitui o placeholder do Bloco 4
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Abre o dialog HTML de configuração do tenant.
 * Usa HtmlService para renderizar SetupTenantDialog.html.
 *
 * ⚠️ GAS RUNTIME: HtmlService.createHtmlOutputFromFile() lê o arquivo
 * pelo nome SEM a extensão .html. O arquivo deve estar na raiz do projeto
 * após o bundle (ou em src/ui/ se o clasp estiver configurado para
 * preservar estrutura de pastas).
 */
function setupTenant() {
    const html = HtmlService
        .createHtmlOutputFromFile('SetupTenantDialog')
        .setTitle('Velozz CRM — Configuração do Tenant')
        .setWidth(680)
        .setHeight(600);
    SpreadsheetApp.getUi().showModalDialog(html, '⚡ Velozz CRM — Configuração');
}

/**
 * Retorna a configuração atual do tenant para preencher o dialog.
 * Chamado pelo client-side via google.script.run.getTenantConfig().
 *
 * @returns {Object.<string, string>} Mapa de todas as configurações atuais
 */
function getTenantConfig() {
    const props = PropertiesService.getScriptProperties().getProperties();
    const defaults = AppConfig.DEFAULTS;

    // Mescla defaults com valores salvos — o dialog sempre mostra algo
    const config = {};
    Object.keys(defaults).forEach(key => {
        config[key] = props[key] !== undefined ? props[key] : defaults[key];
    });
    return config;
}

/**
 * Verifica se a estrutura da planilha é compatível com a configuração
 * informada no dialog, SEM salvar nada ainda.
 * Chamado pelo client-side via google.script.run.verifyTenantCompatibility().
 *
 * @param {Object} configMap - Valores do formulário do dialog
 * @returns {{ valid: boolean, errors: string[], warnings: string[],
 *             found: string[] }}
 */
function verifyTenantCompatibility(configMap) {
    // Cria AppConfig temporário com os valores do dialog (sem persistir)
    const tempConfig = new AppConfig(configMap);
    const tempSheetService = new SheetService(tempConfig, {
        // Logger silencioso para não poluir o LOG durante a verificação
        info: () => { }, warn: () => { }, error: () => { },
    });

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const errors = [];
    const warnings = [];
    const found = [];

    const sheetPF = configMap['SHEET_PF'] || AppConfig.DEFAULTS.SHEET_PF;
    const sheetPJ = configMap['SHEET_PJ'] || AppConfig.DEFAULTS.SHEET_PJ;

    // Verifica se as abas existem
    [{ name: sheetPF, tipo: 'PF' }, { name: sheetPJ, tipo: 'PJ' }]
        .forEach(({ name, tipo }) => {
            const sheet = ss.getSheetByName(name);
            if (!sheet) {
                errors.push(
                    `Aba "${name}" não encontrada. Verifique se o Google Forms ` +
                    `está vinculado a esta planilha e se o nome está correto.`
                );
                return;
            }

            // Valida estrutura de colunas
            const result = tempSheetService.validateSheetStructure(sheet, tipo);
            result.found.forEach(h => found.push(`${tipo}: ${h}`));
            result.missing.forEach(h => {
                errors.push(
                    `Aba ${tipo}: coluna "${h}" não encontrada. ` +
                    `Verifique se a pergunta existe no formulário com este nome exato.`
                );
            });

            // Aviso se a aba parece recém-criada (só tem linha de cabeçalho)
            if (sheet.getLastRow() <= 1) {
                warnings.push(
                    `Aba "${name}" está vazia — nenhum formulário enviado ainda. ` +
                    `Isso é normal na primeira configuração.`
                );
            }
        });

    // Aviso se ALERT_EMAIL não foi preenchido (usará email do owner)
    if (!configMap['ALERT_EMAIL']) {
        warnings.push(
            'E-mail de alertas não configurado. ' +
            'Será usado o e-mail do proprietário do script.'
        );
    }

    return {
        valid: errors.length === 0,
        errors,
        warnings,
        found,
    };
}

/**
 * Persiste as configurações do tenant e executa o setup inicial.
 * Chamado pelo client-side via google.script.run.saveTenantConfig().
 *
 * @param {Object} configMap - Valores validados do formulário do dialog
 * @returns {{ success: boolean, tenantId: string, message: string }}
 */
function saveTenantConfig(configMap) {
    try {
        const appConfig = new AppConfig();

        // Persiste todas as configurações no ScriptProperties
        appConfig.saveAll(configMap);

        // Gera tenant ID único
        const tenantId = appConfig.generateTenantId();

        // Executa setup com as novas configurações
        // Não chama setupInicial() diretamente para evitar o alert() do GAS
        // (alerts não funcionam dentro de callbacks de server-side do HtmlService)
        const logger = new Logger(appConfig);
        logger.info('saveTenantConfig',
            `Tenant configurado: ${configMap['COMPANY_NAME']} | ID: ${tenantId}`
        );

        return { success: true, tenantId, message: 'Configurações salvas.' };

    } catch (e) {
        return { success: false, tenantId: null, message: e.message };
    }
}

/**
 * @typedef {Object} AppContainer
 * @property {AppConfig} appConfig
 * @property {Logger} logger
 * @property {LockManager} lockManager
 * @property {Formatter} formatter
 * @property {DocumentValidator} validator
 * @property {SheetService} sheetService
 * @property {FormService} formService
 * @property {TagService} tagService
 * @property {ContactService} contactService
 * @property {SyncOrchestrator} orchestrator
 */