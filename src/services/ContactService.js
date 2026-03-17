/**
 * @fileoverview Serviço de interação com a People API (Google Contacts).
 *
 * DECISÃO DE ARQUITETURA — SEPARAÇÃO DE RESPONSABILIDADES:
 * ContactService é responsável EXCLUSIVAMENTE por chamadas à People API.
 * Toda lógica de negócio (o que fazer com os dados) fica nos Modules
 * que orquestram ContactService + SheetService + TagService.
 *
 * DECISÃO DE ARQUITETURA — SYNC TOKEN:
 * O sync token é armazenado em UserProperties (não ScriptProperties)
 * porque ele é específico do usuário que executa o trigger time-based.
 * Se outro usuário rodar o sync, ele geraria um token diferente.
 *
 * ⚠️ GAS RUNTIME: People API tem limite de 60 req/s e 10.000 req/dia.
 * Operações em batch (forEach sobre connections) podem atingir o limite
 * se o cliente tiver muitos contatos alterados. Considerar Utilities.sleep()
 * entre iterações em volumes altos.
 * 💡 ROADMAP: paginação de contacts com pageToken para volumes > 100/sync.
 *
 * 📋 CONTACTS: o campo biographies[0].value é o único campo monitorado
 * para correção de DOC. O sistema usa este campo como canal de
 * comunicação operador → sistema.
 */
class ContactService {
  /**
     * @param {AppConfig} appConfig - Instância de configuração do tenant
     * @param {Logger} logger - Instância do logger
     * @param {Object} [peopleAPI] - Injetado para testes (padrão: People)
     * @param {Object} [propertiesService] - Injetado para testes
     */
  constructor(appConfig, logger, peopleAPI, propertiesService) {
    this._config = appConfig;
    this._logger = logger;
    this._people = peopleAPI || People;
    this._userProps = propertiesService ||
            PropertiesService.getUserProperties();
  }

  // ─────────────────────────────────────────────────────────────────────────
  // SEÇÃO 1: OPERAÇÕES CRUD DE CONTATO
  // ─────────────────────────────────────────────────────────────────────────

  /**
     * Cria um novo contato no Google Contacts.
     * @param {Object} payload - Corpo da requisição (montado por FormService)
     * @return {Object} Contato criado (inclui resourceName e etag)
     * @throws {Error} Se a API retornar erro
     */
  create(payload) {
    return this._people.People.createContact(payload);
  }

  /**
     * Busca um contato pelo resourceName com campos específicos.
     * @param {string} resourceName - ID do contato (ex: "people/c123")
     * @param {string} [fields] - Campos desejados (padrão: todos os usados)
     * @return {Object} Contato completo
     */
  get(resourceName, fields) {
    return this._people.People.get(resourceName, {
      personFields: fields ||
                'names,emailAddresses,phoneNumbers,organizations,addresses,biographies',
    });
  }

  /**
     * Atualiza um contato existente. Requer etag para controle de concorrência.
     *
     * ⚠️ GAS RUNTIME: se o contato foi editado no Contacts entre o get()
     * e o update(), o etag muda e a API retorna 409 Conflict. O chamador
     * deve tratar esse caso re-buscando o contato com get() fresco.
     *
     * @param {Object} payload - Corpo com etag e campos a atualizar
     * @param {string} resourceName - ID do contato
     * @param {string} updateFields - Campos a persistir (ex: 'names,emailAddresses')
     * @return {Object} Contato atualizado
     */
  update(payload, resourceName, updateFields) {
    return this._people.People.updateContact(payload, resourceName, {
      updatePersonFields: updateFields ||
                'names,emailAddresses,phoneNumbers,organizations,addresses,biographies',
    });
  }

  /**
     * Atualiza apenas o campo biography de um contato (patch leve).
     * Usado para padronizar o DOC após correção do operador.
     *
     * @param {string} resourceName - ID do contato
     * @param {string} etag - ETag atual do contato
     * @param {string} biographyValue - Novo valor do campo de notas
     * @return {Object} Contato atualizado
     */
  updateBiography(resourceName, etag, biographyValue) {
    return this._people.People.updateContact(
        {etag, biographies: [{value: biographyValue}]},
        resourceName,
        {updatePersonFields: 'biographies'},
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // SEÇÃO 2: SYNC TOKEN (Contacts → Planilha)
  // ─────────────────────────────────────────────────────────────────────────

  /**
     * Busca contatos alterados desde o último sync usando o sync token.
     * Na primeira execução (sem token), apenas gera e persiste o token.
     *
     * 📋 CONTACTS: o sync token captura TODAS as alterações do usuário
     * no Google Contacts, não apenas contatos criados pelo sistema.
     * ContactService.getModifiedContacts() retorna todos — o chamador
     * deve filtrar apenas os que têm resourceName na planilha.
     *
     * @return {SyncResult}
     */
  getModifiedContacts() {
    const syncToken = this._userProps.getProperty('VELOZZ_CONTACTS_SYNC_TOKEN');

    const params = {
      personFields: 'biographies,names,phoneNumbers,emailAddresses',
      requestSyncToken: true,
    };
    if (syncToken) params.syncToken = syncToken;

    const response = this._people.People.Connections.list('people/me', params);

    // Persiste o novo token para o próximo ciclo
    if (response.nextSyncToken) {
      this._userProps.setProperty(
          'VELOZZ_CONTACTS_SYNC_TOKEN',
          response.nextSyncToken,
      );
    }

    const isFirstRun = !syncToken;
    if (isFirstRun) {
      this._logger.info(
          'ContactService.getModifiedContacts',
          'Primeira execução: Sync Token gerado. ' +
                'Próximas alterações no Contacts serão capturadas.',
      );
    }

    return {
      isFirstRun,
      connections: response.connections || [],
      nextSyncToken: response.nextSyncToken || null,
    };
  }

  /**
     * Reseta o sync token (útil para reprocessar todos os contatos).
     * Expõe via menu "⚙️ Flex Velozz" para suporte.
     * 💡 ROADMAP: adicionar ao setupTenant como opção avançada.
     */
  resetSyncToken() {
    this._userProps.deleteProperty('VELOZZ_CONTACTS_SYNC_TOKEN');
    this._logger.info(
        'ContactService.resetSyncToken',
        'Sync Token resetado. Próxima execução gerará novo token.',
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // SEÇÃO 3: HELPERS DE EXTRAÇÃO DE CAMPOS
  // ─────────────────────────────────────────────────────────────────────────

  /**
     * Extrai o número de telefone de um objeto contato (apenas dígitos).
     * @param {Object} contact - Objeto retornado pela People API
     * @return {string} Apenas dígitos, ou string vazia
     */
  extractPhone(contact) {
    return (contact.phoneNumbers && contact.phoneNumbers[0]) ?
            contact.phoneNumbers[0].value.replace(/\D/g, '') :
            '';
  }

  /**
     * Extrai o e-mail de um objeto contato (normalizado lowercase).
     * @param {Object} contact - Objeto retornado pela People API
     * @return {string} Email normalizado, ou string vazia
     */
  extractEmail(contact) {
    return (contact.emailAddresses && contact.emailAddresses[0]) ?
            contact.emailAddresses[0].value.toLowerCase().trim() :
            '';
  }

  /**
     * Extrai o nome completo de um objeto contato.
     * @param {Object} contact - Objeto retornado pela People API
     * @return {string}
     */
  extractFullName(contact) {
    if (!contact.names || !contact.names[0]) return 'Desconhecido';
    const {givenName = '', familyName = ''} = contact.names[0];
    return `${givenName} ${familyName}`.trim();
  }

  /**
     * Extrai o valor do campo biography (notas) de um contato.
     * @param {Object} contact - Objeto retornado pela People API
     * @return {string}
     */
  extractBiography(contact) {
    return (contact.biographies && contact.biographies[0]) ?
            (contact.biographies[0].value || '').trim() :
            '';
  }
}

/**
 * @typedef {Object} SyncResult
 * @property {boolean} isFirstRun - true se não havia sync token anterior
 * @property {Array} connections - Lista de contatos alterados
 * @property {string|null} nextSyncToken - Token para o próximo sync
 */
