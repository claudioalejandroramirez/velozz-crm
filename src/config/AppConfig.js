/**
 * @fileoverview Classe central de configuração SaaS.
 *
 * DECISÃO DE ARQUITETURA:
 * AppConfig é a única classe que lê PropertiesService diretamente.
 * Todas as outras classes recebem uma instância de AppConfig via injeção
 * de dependência — isso permite mockar a configuração inteira em testes
 * sem tocar em PropertiesService.
 *
 * INTEGRAÇÃO COM GOOGLE FORMS:
 * O mapeamento de colunas é configurável por nome de cabeçalho, não por
 * índice. Isso é crítico porque o Google Forms define a ordem das colunas
 * e qualquer reordenação de perguntas no formulário quebraria um sistema
 * baseado em índices fixos.
 *
 * ⚠️ GAS RUNTIME: PropertiesService.getScriptProperties() é compartilhado
 * entre todos os usuários do script. getUserProperties() seria por usuário.
 * Usamos ScriptProperties para que a configuração do tenant valha globalmente.
 */
class AppConfig {
  /**
     * @param {GoogleAppsScript.Properties.Properties} [propertiesService]
     *   Injetado para facilitar testes. Em produção, usa ScriptProperties.
     */
  constructor(propertiesService) {
    // ⚠️ GAS RUNTIME: sem módulos ES, não há "import". A injeção é manual.
    this._props = propertiesService ||
            PropertiesService.getScriptProperties().getProperties();

    this._cache = null; // Lazy-load: configuração montada na primeira chamada
  }

  // ─────────────────────────────────────────────────────────────────────────
  // SEÇÃO 1: ACESSO À CONFIGURAÇÃO
  // ─────────────────────────────────────────────────────────────────────────

  /**
     * Retorna o objeto de configuração completo, construindo-o na primeira
     * chamada e cacheando para evitar releituras do PropertiesService.
     * @return {Object} Configuração completa do tenant
     */
  get config() {
    if (!this._cache) this._cache = this._build();
    return this._cache;
  }

  /**
     * Invalida o cache. Deve ser chamado após salvar novas configurações
     * via setupTenant() para que a próxima leitura reflita os novos valores.
     */
  invalidateCache() {
    this._cache = null;
  }

  /**
     * Retorna o valor de uma propriedade configurável pelo cliente,
     * com fallback para o valor padrão definido em DEFAULTS.
     * @param {string} key - Chave da propriedade
     * @return {string}
     */
  get(key) {
    return this._props[key] !== undefined ?
            this._props[key] :
            AppConfig.DEFAULTS[key];
  }

  // ─────────────────────────────────────────────────────────────────────────
  // SEÇÃO 2: MAPEAMENTO DINÂMICO DE COLUNAS
  // ─────────────────────────────────────────────────────────────────────────

  /**
     * Retorna o nome configurado de um cabeçalho de coluna.
     * Usado por SheetService.getColumnIndex() para localizar colunas
     * pelo nome em vez de por índice fixo.
     *
     * 📋 FORMS: O Google Forms insere o Timestamp como col A automaticamente.
     * Os nomes das demais colunas seguem as perguntas do formulário.
     * Se o cliente renomear uma pergunta no Forms, basta atualizar a
     * propriedade correspondente aqui — sem tocar no código.
     *
     * @param {string} colKey - Chave de configuração (ex: 'COL_NOME_PF')
     * @return {string} Nome do cabeçalho configurado
     */
  getHeaderName(colKey) {
    return this.get(colKey);
  }

  /**
     * Retorna o mapa completo de cabeçalhos esperados para uma aba.
     * Usado em setupInicial() para validar a estrutura da planilha.
     *
     * @param {'PF'|'PJ'} tipo - Tipo da aba
     * @return {Object.<string, string>} Map de { colKey → headerName }
     */
  getExpectedHeaders(tipo) {
    // Colunas comuns a PF e PJ (vindas do Forms + adicionadas pelo script)
    const common = {
      COL_TIMESTAMP: this.get('COL_TIMESTAMP'),
      COL_ENDERECO: this.get('COL_ENDERECO'),
      COL_NUMERO: this.get('COL_NUMERO'),
      COL_COMPLEMENTO: this.get('COL_COMPLEMENTO'),
      COL_TELEFONE: this.get('COL_TELEFONE'),
      COL_EMAIL: this.get('COL_EMAIL'),
      // Colunas adicionadas pelo script (não existem no formulário)
      COL_STATUS: this.get('COL_STATUS'),
      COL_RESOURCE: this.get('COL_RESOURCE'),
      COL_SYNC: this.get('COL_SYNC'),
    };

    if (tipo === 'PF') {
      return {
        ...common,
        COL_NOME_PF: this.get('COL_NOME_PF'),
        COL_SOBRENOME_PF: this.get('COL_SOBRENOME_PF'),
        COL_DOC_PF: this.get('COL_DOC_PF'),
      };
    }

    return {
      ...common,
      COL_NOME_RESPONSAVEL: this.get('COL_NOME_RESPONSAVEL'),
      COL_EMPRESA: this.get('COL_EMPRESA'),
      COL_DOC_PJ: this.get('COL_DOC_PJ'),
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // SEÇÃO 3: IDENTIFICAÇÃO DO TENANT
  // ─────────────────────────────────────────────────────────────────────────

  /**
     * Retorna o tenant ID único gerado no setupTenant().
     * Usado para rastreamento de licença futura.
     * 💡 ROADMAP: integrar com sistema de licenças para SaaS multi-tenant.
     * @return {string|null}
     */
  getTenantId() {
    return this._props['TENANT_ID'] || null;
  }

  /**
     * Gera e persiste um tenant ID único baseado em COMPANY_NAME + timestamp.
     * Chamado internamente por setupTenant().
     * @return {string} O tenant ID gerado
     */
  generateTenantId() {
    const raw = this.get('COMPANY_NAME') + '_' + Date.now();
    // Hash simples (não criptográfico) suficiente para ID único de tenant
    let hash = 0;
    for (let i = 0; i < raw.length; i++) {
      hash = ((hash << 5) - hash) + raw.charCodeAt(i);
      hash |= 0; // Converte para int 32-bit
    }
    const tenantId = 'tenant_' + Math.abs(hash).toString(36);
    PropertiesService.getScriptProperties().setProperty('TENANT_ID', tenantId);
    return tenantId;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // SEÇÃO 4: PERSISTÊNCIA (usado por setupTenant)
  // ─────────────────────────────────────────────────────────────────────────

  /**
     * Persiste um mapa de configurações no ScriptProperties e invalida o cache.
     * @param {Object.<string, string>} configMap - Pares chave/valor a salvar
     */
  saveAll(configMap) {
    const scriptProps = PropertiesService.getScriptProperties();
    Object.keys(configMap).forEach((key) => {
      if (configMap[key] !== null && configMap[key] !== undefined) {
        scriptProps.setProperty(key, String(configMap[key]));
      }
    });
    this.invalidateCache();
    // Força releitura das propriedades atualizadas
    this._props = scriptProps.getProperties();
  }

  // ─────────────────────────────────────────────────────────────────────────
  // SEÇÃO 5: CONSTRUÇÃO INTERNA DO OBJETO DE CONFIGURAÇÃO
  // ─────────────────────────────────────────────────────────────────────────

  /**
     * Constrói o objeto de configuração resolvido, aplicando defaults
     * para todas as chaves não configuradas pelo cliente.
     * @private
     * @return {Object}
     */
  _build() {
    return {
      // Identidade do tenant
      companyName: this.get('COMPANY_NAME'),
      spreadsheetName: this.get('SPREADSHEET_NAME'),
      alertEmail: this.get('ALERT_EMAIL') ||
                Session.getEffectiveUser().getEmail(),

      // Nomes das abas
      sheetPF: this.get('SHEET_PF'),
      sheetPJ: this.get('SHEET_PJ'),
      sheetLog: this.get('SHEET_LOG'),

      // Tags
      tagAlertName: this.get('TAG_ALERT_NAME'),
      tagPhoneName: this.get('TAG_PHONE_NAME'),
      tagEmailName: this.get('TAG_EMAIL_NAME'),
      tagExpiryDays: parseInt(this.get('TAG_EXPIRY_DAYS'), 10),

      // Comportamento
      lockTimeoutMs: parseInt(this.get('LOCK_TIMEOUT_MS'), 10),
      syncHour: parseInt(this.get('SYNC_HOUR'), 10),

      // Nomes dos cabeçalhos (resolução do mapeamento dinâmico)
      // 📋 FORMS: esses valores podem ser sobrescritos pelo cliente
      // para adaptar ao idioma ou estrutura do formulário dele.
      headers: {
        timestamp: this.get('COL_TIMESTAMP'),
        tipoPessoa: this.get('COL_TIPO_PESSOA'),
        nomePF: this.get('COL_NOME_PF'),
        sobrenomePF: this.get('COL_SOBRENOME_PF'),
        docPF: this.get('COL_DOC_PF'),
        nomeResponsavel: this.get('COL_NOME_RESPONSAVEL'),
        empresa: this.get('COL_EMPRESA'),
        docPJ: this.get('COL_DOC_PJ'),
        endereco: this.get('COL_ENDERECO'),
        numero: this.get('COL_NUMERO'),
        complemento: this.get('COL_COMPLEMENTO'),
        telefone: this.get('COL_TELEFONE'),
        email: this.get('COL_EMAIL'),
        // Colunas gerenciadas pelo script (não pelo Forms)
        status: this.get('COL_STATUS'),
        resourceName: this.get('COL_RESOURCE'),
        ultimaAtualizacao: this.get('COL_SYNC'),
      },
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// DEFAULTS — Valores padrão para todos os tenants
// Alterados apenas pelo cliente via setupTenant(), nunca hardcoded no código
// ─────────────────────────────────────────────────────────────────────────────
AppConfig.DEFAULTS = {
  // Identidade
  COMPANY_NAME: 'Minha Empresa',
  SPREADSHEET_NAME: 'Cadastro de Clientes',
  ALERT_EMAIL: '', // fallback: Session.getEffectiveUser().getEmail()

  // Abas
  SHEET_PF: 'PF',
  SHEET_PJ: 'PJ',
  SHEET_LOG: 'LOG',

  // Tags
  TAG_ALERT_NAME: 'revisar',
  TAG_PHONE_NAME: 'novo-telefone',
  TAG_EMAIL_NAME: 'novo-email',
  TAG_EXPIRY_DAYS: '30',

  // Comportamento
  LOCK_TIMEOUT_MS: '10000',
  SYNC_HOUR: '3',

  // ── Mapeamento de colunas (nomes dos cabeçalhos) ─────────────────────────
  // 📋 FORMS: COL_TIMESTAMP é sempre col A (inserida automaticamente pelo
  // Google Forms). Não é possível remover ou mover essa coluna.
  COL_TIMESTAMP: 'Data',

  // 📋 FORMS: COL_TIPO_PESSOA é a pergunta de roteamento que determina
  // se o respondente é PF ou PJ. Deve ser a 2ª pergunta em ambos os forms.
  COL_TIPO_PESSOA: 'Tipo',

  // Colunas específicas de PF
  COL_NOME_PF: 'Nome',
  COL_SOBRENOME_PF: 'Sobrenome',
  COL_DOC_PF: 'CPF',

  // Colunas específicas de PJ
  COL_NOME_RESPONSAVEL: 'Nome Responsável',
  COL_EMPRESA: 'Empresa',
  COL_DOC_PJ: 'CNPJ',

  // Colunas comuns (PF e PJ)
  COL_ENDERECO: 'Endereço',
  COL_NUMERO: 'Número',
  COL_COMPLEMENTO: 'Complemento',
  COL_TELEFONE: 'Telefone',
  COL_EMAIL: 'Email',

  // ── Colunas adicionadas pelo SCRIPT (não existem no formulário) ──────────
  // ⚠️ Estas colunas são adicionadas à direita das respostas do Forms.
  // O script as cria no setupInicial(). O Forms NUNCA as toca.
  COL_STATUS: 'Status',
  COL_RESOURCE: 'ResourceName',
  COL_SYNC: 'Última Atualização',
};
