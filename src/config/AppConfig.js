/**
 * @fileoverview Configuração central do sistema.
 * Extraído do monolito: MÓDULO 1 (CONFIG) e MÓDULO 2 (onOpen).
 */
class AppConfig {
  constructor(propertiesService) {
    // Se um PropertiesService for passado (para testes), usa ele. Caso contrário, obtém as propriedades reais.
    this._propsService = propertiesService || PropertiesService.getScriptProperties();
    this._props = this._propsService.getProperties();
    this._cache = null;
  }

  // Mantém as constantes como propriedades estáticas da classe.
  static get DEFAULTS() {
    return {
      ABA_RESPOSTAS: 'Respostas ao formulário 1', // ← NOVO
      ABA_PF: 'PF',
      ABA_PJ: 'PJ',
      ABA_LOG: 'LOG',
      COLUNA_RESOURCE: 11,
      COLUNA_SYNC: 12,
      COLUNA_STATUS: 10,
      COLUNA_DOC: 4,
      COLUNA_TELEFONE: 8,
      COLUNA_EMAIL: 9,
      NOME_TAG_ALERTA: 'revisar',
      NOME_TAG_NOVO_TELEFONE: 'novo-telefone',
      NOME_TAG_NOVO_EMAIL: 'novo-email',
      TAG_EXPIRY_DIAS: 30,
    };
  }

  get config() {
    if (!this._cache) {
      this._cache = this._build();
    }
    return this._cache;
  }

  invalidateCache() {
    this._cache = null;
    this._props = this._propsService.getProperties(); // Recarrega as props
  }

  get(key) {
    return this._props[key] !== undefined ? this._props[key] : AppConfig.DEFAULTS[key];
  }

  // Retorna o índice da coluna (1-based). Útil para SheetService.
  getColumnIndex(key) {
    return parseInt(this.get(key), 10);
  }

  // Retorna o nome da aba de respostas do Forms.
  getRespostasSheetName() {
    return this.get('ABA_RESPOSTAS');
  }

  // Retorna o nome da aba PF.
  getPfSheetName() {
    return this.get('ABA_PF');
  }

  // Retorna o nome da aba PJ.
  getPjSheetName() {
    return this.get('ABA_PJ');
  }

  // Retorna o nome da aba de LOG.
  getLogSheetName() {
    return this.get('ABA_LOG');
  }

  // Getters para as tags
  getTagAlerta() {
    return this.get('NOME_TAG_ALERTA');
  }
  getTagNovoTelefone() {
    return this.get('NOME_TAG_NOVO_TELEFONE');
  }
  getTagNovoEmail() {
    return this.get('NOME_TAG_NOVO_EMAIL');
  }
  getTagExpiryDays() {
    return parseInt(this.get('TAG_EXPIRY_DIAS'), 10);
  }

  // Salva múltiplas configurações.
  saveAll(configMap) {
    Object.keys(configMap).forEach((key) => {
      if (configMap[key] !== null && configMap[key] !== undefined) {
        this._propsService.setProperty(key, String(configMap[key]));
      }
    });
    this.invalidateCache();
  }

  _build() {
    return {
      abaRespostas: this.get('ABA_RESPOSTAS'),
      abaPF: this.get('ABA_PF'),
      abaPJ: this.get('ABA_PJ'),
      abaLOG: this.get('ABA_LOG'),
      colunaResource: this.getColumnIndex('COLUNA_RESOURCE'),
      colunaSync: this.getColumnIndex('COLUNA_SYNC'),
      colunaStatus: this.getColumnIndex('COLUNA_STATUS'),
      colunaDoc: this.getColumnIndex('COLUNA_DOC'),
      colunaTelefone: this.getColumnIndex('COLUNA_TELEFONE'),
      colunaEmail: this.getColumnIndex('COLUNA_EMAIL'),
      tagAlerta: this.get('NOME_TAG_ALERTA'),
      tagNovoTelefone: this.get('NOME_TAG_NOVO_TELEFONE'),
      tagNovoEmail: this.get('NOME_TAG_NOVO_EMAIL'),
      tagExpiryDays: parseInt(this.get('TAG_EXPIRY_DIAS'), 10),
    };
  }
}

// Para permitir testes no Node.js
if (typeof module !== 'undefined') {
  module.exports = AppConfig;
}
