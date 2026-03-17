/**
 * @fileoverview Serviço de gestão de labels/grupos no Google Contacts.
 *
 * DECISÃO DE ARQUITETURA — CACHE DE GRUPOS:
 * Cada chamada a People.ContactGroups.list() consome quota da API.
 * TagService mantém um cache em memória dos grupos existentes durante
 * a execução. O cache é invalidado apenas quando um grupo é criado,
 * garantindo que obterOuCriarGrupo() faça no máximo 2 chamadas à API
 * por grupo novo (list + create) e 0 chamadas para grupos já conhecidos.
 *
 * DECISÃO DE ARQUITETURA — EXPIRAÇÃO VIA ScriptProperties:
 * Tags temporárias (novo-telefone, novo-email) expiram em 30 dias.
 * O timer é armazenado em ScriptProperties com chave estruturada:
 *   TAG_EXPIRY_{resourceNameSafe}_{tagNameSafe}
 * Ao reaplicar uma tag antes de expirar, o timer é reiniciado.
 *
 * ⚠️ GAS RUNTIME: ScriptProperties tem limite de 500KB total e
 * 9KB por propriedade. Cada entrada de expiração usa ~200 bytes.
 * Limite prático: ~2.500 tags temporárias simultâneas.
 * 💡 ROADMAP: comprimir o JSON de expiração para aumentar o limite.
 *
 * ⚠️ GAS RUNTIME: People.ContactGroups.Members.modify() falha
 * silenciosamente se o contato já estiver no grupo — isso é esperado
 * e tratado com try/catch nos métodos de remoção.
 */
class TagService {
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
        this._props = propertiesService || PropertiesService.getScriptProperties();

        // Cache em memória: { groupName → resourceName }
        // Válido apenas durante a execução atual do script
        this._groupCache = null;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // SEÇÃO 1: APLICAÇÃO E REMOÇÃO DE TAGS
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Aplica uma tag (grupo do Contacts) a um contato.
     * Cria o grupo automaticamente se não existir.
     *
     * @param {string} resourceName - ID do contato (ex: "people/c123")
     * @param {string} groupName - Nome do grupo/tag
     */
    apply(resourceName, groupName) {
        const groupRef = this._getOrCreateGroup(groupName);
        if (!groupRef) return;

        try {
            this._people.ContactGroups.Members.modify(
                { resourceNamesToAdd: [resourceName] },
                groupRef
            );
        } catch (e) {
            // Falha silenciosa: contato pode já estar no grupo
            this._logger.warn(
                'TagService.apply',
                `Falha ao aplicar tag "${groupName}" em ${resourceName}: ${e.message}`
            );
        }
    }

    /**
     * Remove uma tag de um contato.
     * Não lança erro se o contato não estiver no grupo.
     *
     * @param {string} resourceName - ID do contato
     * @param {string} groupName - Nome do grupo/tag
     */
    remove(resourceName, groupName) {
        const groups = this._loadGroupCache();
        const group = groups[groupName];
        if (!group) return; // Grupo não existe — nada a remover

        try {
            this._people.ContactGroups.Members.modify(
                { resourceNamesToRemove: [resourceName] },
                group
            );
        } catch (e) {
            // Esperado: contato pode não estar no grupo
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // SEÇÃO 2: TAGS TEMPORÁRIAS COM EXPIRAÇÃO
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Aplica uma tag E registra seu timer de expiração.
     * Se a tag já existia com timer ativo, reinicia o timer para +30 dias.
     *
     * @param {string} resourceName - ID do contato
     * @param {string} tagName - Nome da tag temporária
     */
    applyTemporary(resourceName, tagName) {
        this.apply(resourceName, tagName);

        const key = this._expiryKey(resourceName, tagName);
        const expiryMs = Date.now() +
            (this._config.config.tagExpiryDays * 24 * 60 * 60 * 1000);

        const payload = JSON.stringify({ resourceName, tagName, expiry: expiryMs });

        try {
            this._props.setProperty(key, payload);
            this._logger.info(
                'TagService.applyTemporary',
                `Tag temporária aplicada: "${tagName}" em ${resourceName} | ` +
                `expira em: ${new Date(expiryMs).toISOString()}`
            );
        } catch (e) {
            this._logger.warn(
                'TagService.applyTemporary',
                `Falha ao salvar expiração (ScriptProperties cheio?): ${e.message}`
            );
        }
    }

    /**
     * Limpa todas as tags temporárias expiradas.
     * Deve ser executado pelo trigger diário (3h da manhã).
     *
     * Para cada chave TAG_EXPIRY_* no ScriptProperties:
     *   - Se expirou: remove a tag do Contacts e deleta a chave
     *   - Se o JSON estiver corrompido: deleta a chave (limpeza defensiva)
     *
     * @returns {number} Quantidade de tags removidas
     */
    cleanExpired() {
        const allProps = this._props.getProperties();
        const now = Date.now();
        let removed = 0;

        Object.keys(allProps).forEach(key => {
            if (!key.startsWith('TAG_EXPIRY_')) return;

            try {
                const data = JSON.parse(allProps[key]);

                if (now >= data.expiry) {
                    this.remove(data.resourceName, data.tagName);
                    this._props.deleteProperty(key);
                    removed++;
                    this._logger.info(
                        'TagService.cleanExpired',
                        `Tag expirada removida: "${data.tagName}" de ${data.resourceName}`
                    );
                }
            } catch (e) {
                // JSON corrompido — limpa para evitar acúmulo de lixo
                this._props.deleteProperty(key);
                this._logger.warn(
                    'TagService.cleanExpired',
                    `Entrada inválida removida: ${key} | erro: ${e.message}`
                );
            }
        });

        if (removed > 0) {
            this._logger.info(
                'TagService.cleanExpired',
                `Limpeza concluída: ${removed} tag(s) expirada(s) removida(s).`
            );
        }

        return removed;
    }

    /**
     * Verifica se existe um timer ativo para uma tag temporária.
     * Útil para checar se a tag ainda não expirou antes de reaplicar.
     *
     * @param {string} resourceName - ID do contato
     * @param {string} tagName - Nome da tag
     * @returns {boolean}
     */
    hasActiveTimer(resourceName, tagName) {
        const key = this._expiryKey(resourceName, tagName);
        try {
            const raw = this._props.getProperty(key);
            if (!raw) return false;
            const data = JSON.parse(raw);
            return Date.now() < data.expiry;
        } catch (e) {
            return false;
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // SEÇÃO 3: HELPERS DE DETECÇÃO DE MUDANÇA
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Verifica se telefone mudou entre a planilha e o Contacts.
     * Compara apenas dígitos para ignorar diferenças de formatação.
     * Ex: "(11) 91234-5678" === "11912345678" → sem mudança.
     *
     * @param {string} phoneInSheet - Telefone na planilha (pode ter máscara)
     * @param {string} phoneInContacts - Telefone no Contacts (pode ter máscara)
     * @returns {boolean}
     */
    static phoneChanged(phoneInSheet, phoneInContacts) {
        if (!phoneInSheet || !phoneInContacts) return false;
        const a = (phoneInSheet || '').replace(/\D/g, '');
        const b = (phoneInContacts || '').replace(/\D/g, '');
        return a !== b && a !== '' && b !== '';
    }

    /**
     * Verifica se e-mail mudou entre a planilha e o Contacts.
     * Compara em lowercase sem espaços para ignorar variações de casing.
     * Ex: "Email@X.com" === "email@x.com" → sem mudança.
     *
     * @param {string} emailInSheet - Email na planilha
     * @param {string} emailInContacts - Email no Contacts
     * @returns {boolean}
     */
    static emailChanged(emailInSheet, emailInContacts) {
        if (!emailInSheet || !emailInContacts) return false;
        const a = (emailInSheet || '').toLowerCase().trim();
        const b = (emailInContacts || '').toLowerCase().trim();
        return a !== b && a !== '' && b !== '';
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PRIVADO
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Gera chave segura para ScriptProperties sem caracteres especiais.
     * Substitui tudo que não é alfanumérico por '_'.
     *
     * @private
     * @param {string} resourceName
     * @param {string} tagName
     * @returns {string}
     */
    _expiryKey(resourceName, tagName) {
        const rnSafe = resourceName.replace(/[^a-zA-Z0-9]/g, '_');
        const tagSafe = tagName.replace(/[^a-zA-Z0-9]/g, '_');
        return `TAG_EXPIRY_${rnSafe}_${tagSafe}`;
    }

    /**
     * Carrega o cache de grupos do Contacts (uma chamada à API por execução).
     * @private
     * @returns {Object.<string, string>} Map de { groupName → resourceName }
     */
    _loadGroupCache() {
        if (this._groupCache !== null) return this._groupCache;

        this._groupCache = {};
        try {
            const response = this._people.ContactGroups.list();
            if (response.contactGroups) {
                response.contactGroups.forEach(group => {
                    const name = group.name || group.formattedName;
                    if (name) this._groupCache[name] = group.resourceName;
                });
            }
        } catch (e) {
            this._logger.error(
                'TagService._loadGroupCache',
                `Falha ao carregar grupos: ${e.message}`
            );
        }

        return this._groupCache;
    }

    /**
     * Retorna o resourceName de um grupo, criando-o se não existir.
     * Invalida o cache se criar um novo grupo.
     *
     * @private
     * @param {string} groupName - Nome do grupo
     * @returns {string|null} resourceName do grupo
     */
    _getOrCreateGroup(groupName) {
        const groups = this._loadGroupCache();

        if (groups[groupName]) return groups[groupName];

        try {
            const newGroup = this._people.ContactGroups.create({
                contactGroup: { name: groupName },
            });
            // Invalida cache para incluir o novo grupo
            this._groupCache = null;
            this._logger.info(
                'TagService._getOrCreateGroup',
                `Grupo criado: "${groupName}" → ${newGroup.resourceName}`
            );
            return newGroup.resourceName;
        } catch (e) {
            this._logger.error(
                'TagService._getOrCreateGroup',
                `Falha ao criar grupo "${groupName}": ${e.message}`
            );
            return null;
        }
    }
}