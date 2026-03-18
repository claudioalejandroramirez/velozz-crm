/**
 * @fileoverview Funções globais de trigger do Google Apps Script.
 * Extraído dos MÓDULOS 2, 3, 5, 6 e 7.
 * Serve apenas como ponto de entrada, delegando toda a lógica para os serviços.
 */

// --- Container de Dependências (Injeção manual para o GAS) ---
function _getContainer() {
  const appConfig = new AppConfig();
  const logger = new Logger(appConfig);
  const lockManager = new LockManager(logger);
  const formatter = Formatter;
  const validator = new DocumentValidator();
  const sheetService = new SheetService(appConfig, logger);
  const formService = new FormService(validator, formatter);
  const contactService = new ContactService(logger);
  const tagService = new TagService(appConfig, logger, contactService);
  const orchestrator = new SyncOrchestrator(
    appConfig, logger, sheetService, formService,
    contactService, tagService, validator, formatter
  );

  return {
    appConfig, logger, lockManager, sheetService, orchestrator, tagService
  };
}

// --- MÓDULO 2: Menu Customizado ---
function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu('⚙️ Flex Velozz')
    .addItem('Executar Setup Inicial', 'setupInicial')
    .addSeparator()
    .addItem('Forçar Sync (Contacts → Planilha)', 'syncContatosParaPlanilha')
    .addSeparator()
    .addItem('Limpar Tags Expiradas', 'limparTagsExpiradas')
    .addItem('Ver LOG', 'verLog')
    .addToUi();
}

function verLog() {
  const { appConfig, sheetService } = _getContainer();
  const logSheet = sheetService.getSheetLOG();
  if (!logSheet) {
    SpreadsheetApp.getUi().alert('Aba LOG não encontrada. Execute o Setup Inicial primeiro.');
    return;
  }
  logSheet.showSheet();
  SpreadsheetApp.getActiveSpreadsheet().setActiveSheet(logSheet);
}

// --- MÓDULO 3: Setup Inicial ---
function setupInicial() {
  const { appConfig, sheetService, logger, tagService } = _getContainer();

  // 1. Configura as abas PF e PJ
  sheetService.setupInicial();

  // 2. Garante que a aba LOG exista (o Logger já faz isso, mas vamos garantir que o setup a crie se não existir)
  // O método _garantirAbaLog do Logger é privado, então forçamos um log para criá-la.
  logger.info('setupInicial', 'Verificando/criando aba LOG...');

  // 3. Cria trigger diário para limparTagsExpiradas (3h da manhã) se não existir
  const triggers = ScriptApp.getProjectTriggers();
  const jaTemTrigger = triggers.some(t => t.getHandlerFunction() === 'limparTagsExpiradas');
  if (!jaTemTrigger) {
    ScriptApp.newTrigger('limparTagsExpiradas').timeBased().everyDays(1).atHour(3).create();
    logger.info('setupInicial', 'Trigger diário para limparTagsExpiradas criado (3h).');
  }

  logger.info('setupInicial', 'Setup executado com sucesso.');
  SpreadsheetApp.getUi().alert(
    '✅ Setup Concluído!\n\nAbas PF, PJ e LOG preparadas.\n' +
    'Trigger diário de limpeza de tags configurado para às 3h.'
  );
}

// --- MÓDULO 5: Forms → Sheets → Contacts ---
function processarFormulario(e) {
  if (!e || !e.values) return;

  const { appConfig, lockManager, logger, orchestrator } = _getContainer();

  const tipo = e.values[1];
  if (tipo !== 'Pessoa Física' && tipo !== 'Pessoa Jurídica') {
    logger.warn('processarFormulario', `Tipo desconhecido: ${tipo}`);
    return;
  }

  lockManager.withLock(
    () => orchestrator.processarNovoContato(e, tipo),
    () => logger.warn('processarFormulario', `Lock não obtido para processar formulário.`),
    `processarFormulario:${tipo}`
  );
}

// --- MÓDULO 6: Sheets → Contacts (onEdit) ---
function syncPlanilhaParaContatos(e) {
  const { lockManager, logger, orchestrator } = _getContainer();

  lockManager.withLock(
    () => orchestrator.syncPlanilhaParaContatos(e),
    () => {
      if (e && e.range) {
        e.range.getSheet().getRange(e.range.getRow(), 10).setValue('Aguardando lock — tente novamente');
      }
      logger.warn('syncPlanilhaParaContatos', 'Lock não obtido para edição.');
    },
    'syncPlanilhaParaContatos'
  );
}

// --- MÓDULO 7: Contacts → Sheets (time-based) ---
function syncContatosParaPlanilha() {
  const { orchestrator } = _getContainer();
  orchestrator.syncContatosParaPlanilha();
}

// --- MÓDULO 8: Limpeza de Tags Expiradas ---
function limparTagsExpiradas() {
  const { tagService } = _getContainer();
  tagService.limparTagsExpiradas();
}

// Para permitir testes no Node.js (embora não seja comum testar triggers diretamente)
if (typeof module !== 'undefined') {
  module.exports = {
    onOpen,
    verLog,
    setupInicial,
    processarFormulario,
    syncPlanilhaParaContatos,
    syncContatosParaPlanilha,
    limparTagsExpiradas
  };
}