/**
 * @fileoverview Serviço para interação com a People API (Google Contacts).
 * Extraído dos MÓDULOS 5, 6, 7 e 9.
 */
class ContactService {
  constructor(logger, peopleAPI, propertiesService) {
    this._logger = logger;
    this._people = peopleAPI || People;
    this._userProps = propertiesService || PropertiesService.getUserProperties();
  }

  createContact(payload) {
    return this._people.People.createContact(payload);
  }

  getContact(resourceName) {
    return this._people.People.get(resourceName, {
      personFields: 'names,emailAddresses,phoneNumbers,organizations,addresses,biographies'
    });
  }

  updateContact(payload, resourceName) {
    return this._people.People.updateContact(payload, resourceName, {
      updatePersonFields: 'names,emailAddresses,phoneNumbers,organizations,addresses,biographies'
    });
  }

  updateBiography(resourceName, etag, biographyValue) {
    return this._people.People.updateContact(
      { etag, biographies: [{ value: biographyValue }] },
      resourceName,
      { updatePersonFields: 'biographies' }
    );
  }

  // --- Gestão de Tags (Grupos) ---
  // Cache simples em memória para evitar múltiplas listagens.
  _groupCache = null;

  _listGroups() {
    if (this._groupCache) return this._groupCache;
    const response = this._people.ContactGroups.list();
    this._groupCache = response.contactGroups || [];
    return this._groupCache;
  }

  _invalidateGroupCache() {
    this._groupCache = null;
  }

  obterOuCriarGrupo(nomeGrupo) {
    const grupos = this._listGroups();
    let grupo = grupos.find(g => g.name === nomeGrupo || g.formattedName === nomeGrupo);

    if (grupo) {
      return grupo.resourceName;
    }

    // Grupo não existe, criar
    const novoGrupo = this._people.ContactGroups.create({ contactGroup: { name: nomeGrupo } });
    this._invalidateGroupCache(); // Invalida o cache pois a lista mudou
    this._logger.info('ContactService.obterOuCriarGrupo', `Grupo criado: ${nomeGrupo}`);
    return novoGrupo.resourceName;
  }

  aplicarTag(resourceName, nomeGrupo) {
    const grupoRef = this.obterOuCriarGrupo(nomeGrupo);
    if (grupoRef) {
      try {
        this._people.ContactGroups.Members.modify(
          { resourceNamesToAdd: [resourceName] },
          grupoRef
        );
      } catch (e) {
        // Falha silenciosa: contato pode já estar no grupo
        this._logger.warn('ContactService.aplicarTag', `Falha ao aplicar tag ${nomeGrupo}: ${e.message}`);
      }
    }
  }

  removerTag(resourceName, nomeGrupo) {
    const grupos = this._listGroups();
    const grupo = grupos.find(g => g.name === nomeGrupo || g.formattedName === nomeGrupo);
    if (grupo) {
      try {
        this._people.ContactGroups.Members.modify(
          { resourceNamesToRemove: [resourceName] },
          grupo.resourceName
        );
      } catch (e) {
        // Ignora: contato pode não estar no grupo
      }
    }
  }

  // --- Sync Token (MÓDULO 7) ---
  getSyncToken() {
    return this._userProps.getProperty('CONTACTS_SYNC_TOKEN');
  }

  setSyncToken(token) {
    if (token) {
      this._userProps.setProperty('CONTACTS_SYNC_TOKEN', token);
    }
  }

  listConnections(syncToken) {
    const params = {
      personFields: 'biographies,names,phoneNumbers,emailAddresses',
      requestSyncToken: true
    };
    if (syncToken) params.syncToken = syncToken;

    return this._people.People.Connections.list('people/me', params);
  }
}

if (typeof module !== 'undefined') {
  module.exports = ContactService;
}