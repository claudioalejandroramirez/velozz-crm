/**
 * @fileoverview Gestão de tags temporárias com expiração.
 * Extraído do MÓDULO 8.
 */
class TagService {
  constructor(appConfig, logger, contactService, propertiesService) {
    this._config = appConfig;
    this._logger = logger;
    this._contactService = contactService;
    this._props = propertiesService || PropertiesService.getScriptProperties();
  }

  // Gera chave única para o PropertiesService.
  _chaveExpiracao(resourceName, tagName) {
    const rnSafe = resourceName.replace(/[^a-zA-Z0-9]/g, '_');
    const tagSafe = tagName.replace(/[^a-zA-Z0-9]/g, '_');
    return `TAG_EXPIRY_${rnSafe}_${tagSafe}`;
  }

  aplicarTagTemporaria(resourceName, tagName) {
    // Aplica a tag no contato
    this._contactService.aplicarTag(resourceName, tagName);

    // Registra a expiração
    const chave = this._chaveExpiracao(resourceName, tagName);
    const dados = JSON.stringify({
      resourceName: resourceName,
      tagName: tagName,
      expiry: Date.now() + (this._config.getTagExpiryDays() * 24 * 60 * 60 * 1000)
    });

    try {
      this._props.setProperty(chave, dados);
    } catch (e) {
      this._logger.warn('TagService.aplicarTagTemporaria', `Falha ao salvar expiração: ${e.message}`);
    }
  }

  limparTagsExpiradas() {
    const todasPropriedades = this._props.getProperties();
    const agora = Date.now();
    let removidas = 0;

    Object.keys(todasPropriedades).forEach(chave => {
      if (!chave.startsWith('TAG_EXPIRY_')) return;

      try {
        const dados = JSON.parse(todasPropriedades[chave]);
        if (agora >= dados.expiry) {
          this._contactService.removerTag(dados.resourceName, dados.tagName);
          this._props.deleteProperty(chave);
          removidas++;
          this._logger.info('TagService.limparTagsExpiradas',
            `Tag expirada removida: "${dados.tagName}" de ${dados.resourceName}`);
        }
      } catch (e) {
        // Entrada malformada, limpar
        this._props.deleteProperty(chave);
        this._logger.warn('TagService.limparTagsExpiradas', `Entrada inválida removida: ${chave}`);
      }
    });

    if (removidas > 0) {
      this._logger.info('TagService.limparTagsExpiradas', `Limpeza concluída: ${removidas} tag(s) expirada(s).`);
    }
    return removidas;
  }
}

if (typeof module !== 'undefined') {
  module.exports = TagService;
}