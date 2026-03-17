/**
 * @fileoverview Serviço de processamento de respostas do Google Forms.
 *
 * DECISÃO DE ARQUITETURA — EXTRAÇÃO BASEADA EM CABEÇALHO:
 * A função extrairDados() original usava índices fixos (valores[2],
 * valores[4], etc.) que dependiam da ordem exata das perguntas no Forms.
 * FormService usa os valores do evento onFormSubmit combinados com
 * a leitura dos cabeçalhos da aba para extrair dados por nome de coluna,
 * não por posição.
 *
 * 📋 FORMS — ESTRUTURA DO EVENTO onFormSubmit:
 * O evento `e` recebido pelo trigger tem:
 *   e.values   → array com todas as respostas NA MESMA ORDEM das colunas
 *   e.namedValues → objeto { "Nome da Pergunta": [valor] } (mais robusto)
 * Este serviço usa e.namedValues quando disponível, com fallback para
 * e.values + leitura de cabeçalhos da aba.
 *
 * ⚠️ GAS RUNTIME: e.namedValues está disponível em onFormSubmit mas NÃO
 * em onEdit. Para sync de edição, use SheetService.getRowAsObject().
 */
class FormService {
    /**
     * @param {AppConfig} appConfig - Instância de configuração do tenant
     * @param {Logger} logger - Instância do logger
     * @param {SheetService} sheetService - Instância do SheetService
     * @param {DocumentValidator} validator - Instância do DocumentValidator
     * @param {Formatter} formatter - Classe Formatter (estática)
     */
    constructor(appConfig, logger, sheetService, validator, formatter) {
        this._config = appConfig;
        this._logger = logger;
        this._sheetService = sheetService;
        this._validator = validator;
        this._formatter = formatter;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // SEÇÃO 1: EXTRAÇÃO DE DADOS DO FORMULÁRIO
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Extrai e normaliza os dados de um evento de formulário.
     * Usa e.namedValues (robusto) com fallback para e.values + cabeçalhos.
     *
     * 📋 FORMS: e.namedValues usa exatamente o texto da pergunta no Forms
     * como chave. Se o cliente renomear a pergunta, basta atualizar a
     * configuração COL_* correspondente — o código não muda.
     *
     * @param {Object} formEvent - Evento onFormSubmit (e)
     * @param {'PF'|'PJ'} tipo - Tipo identificado pelo campo de roteamento
     * @returns {FormData} Objeto com dados normalizados e validados
     */
    extractFormData(formEvent, tipo) {
        const headers = this._config.config.headers;
        const named = formEvent.namedValues || {};

        /**
         * Extrai um valor de namedValues pelo nome configurado.
         * @param {string} headerKey - Chave do header em headers (ex: 'nomePF')
         * @returns {string}
         */
        const get = (headerKey) => {
            const headerName = headers[headerKey];
            const val = named[headerName];
            return val ? val[0] : '';
        };

        const isPF = tipo === 'PF';
        const docRaw = isPF ? get('docPF') : get('docPJ');
        const docLimpo = this._formatter.digitsOnly(docRaw);
        const telefoneLimpo = this._formatter.digitsOnly(get('telefone'));
        const isValid = isPF
            ? this._validator.validateCPF(docLimpo)
            : this._validator.validateCNPJ(docLimpo);

        return {
            tipo,
            isPF,
            nome: get(isPF ? 'nomePF' : 'nomeResponsavel'),
            sobrenome: isPF ? get('sobrenomePF') : '',
            empresa: !isPF ? get('empresa') : '',
            documentoLimpo: docLimpo,
            docTipo: isPF ? 'CPF' : 'CNPJ',
            logradouro: get('endereco'),
            numero: get('numero'),
            complemento: get('complemento'),
            telefoneLimpo,
            email: get('email'),
            isValid,
        };
    }

    /**
     * Extrai dados de uma linha da planilha para uso no sync onEdit.
     * Usa SheetService.getRowAsObject() para leitura por nome de cabeçalho.
     *
     * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet - Aba da linha
     * @param {number} row - Número da linha (1-based)
     * @param {'PF'|'PJ'} tipo - Tipo da aba
     * @returns {FormData} Objeto com dados normalizados e validados
     */
    extractRowData(sheet, row, tipo) {
        const headers = this._config.config.headers;
        const rowObj = this._sheetService.getRowAsObject(sheet, row);
        const isPF = tipo === 'PF';

        const docRaw = isPF
            ? rowObj[headers.docPF]
            : rowObj[headers.docPJ];
        const docLimpo = this._formatter.digitsOnly(docRaw);
        const telefoneLimpo = this._formatter.digitsOnly(rowObj[headers.telefone]);
        const isValid = isPF
            ? this._validator.validateCPF(docLimpo)
            : this._validator.validateCNPJ(docLimpo);

        return {
            tipo,
            isPF,
            nome: isPF ? rowObj[headers.nomePF] : rowObj[headers.nomeResponsavel],
            sobrenome: isPF ? rowObj[headers.sobrenomePF] : '',
            empresa: !isPF ? rowObj[headers.empresa] : '',
            documentoLimpo: docLimpo,
            docTipo: isPF ? 'CPF' : 'CNPJ',
            logradouro: rowObj[headers.endereco],
            numero: rowObj[headers.numero],
            complemento: rowObj[headers.complemento],
            telefoneLimpo,
            email: rowObj[headers.email] || '',
            isValid,
        };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // SEÇÃO 2: CONSTRUÇÃO DE OBJETOS PARA A PLANILHA
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Constrói o objeto de pessoa para a People API com base nos dados do form.
     * @param {FormData} dados - Dados extraídos do formulário
     * @returns {Object} Corpo da requisição para People.People.createContact()
     */
    buildContactPayload(dados) {
        const p = {
            names: [{
                givenName: dados.nome || '',
                familyName: dados.sobrenome || '',
            }],
        };

        if (dados.email) {
            p.emailAddresses = [{ value: dados.email, type: 'work' }];
        }

        const telFormatado = this._formatter.phone(dados.telefoneLimpo);
        if (telFormatado) {
            p.phoneNumbers = [{ value: telFormatado, type: 'work' }];
        }

        if (dados.empresa) {
            p.organizations = [{ name: dados.empresa, type: 'work' }];
        }

        let endereco = (dados.logradouro || '') +
            (dados.numero ? `, ${dados.numero}` : '');
        if (dados.complemento) endereco += ` - ${dados.complemento}`;
        if (endereco.trim()) {
            p.addresses = [{ streetAddress: endereco.trim(), type: 'work' }];
        }

        if (dados.documentoLimpo && dados.docTipo) {
            const docFormatado = dados.isValid
                ? this._formatter.document(dados.documentoLimpo, dados.docTipo)
                : `${dados.documentoLimpo} [INVÁLIDO]`;
            p.biographies = [{
                value: `${dados.docTipo}: ${docFormatado}`,
            }];
        }

        return p;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // SEÇÃO 3: VERIFICAÇÃO DE ESTRUTURA DO FORMULÁRIO
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Verifica se a estrutura do evento do Forms é compatível com a
     * configuração atual. Chamado em processarFormulario() antes de qualquer
     * processamento para evitar erros silenciosos por mudança no Forms.
     *
     * 📋 FORMS: se o cliente renomear uma pergunta no Forms sem atualizar
     * a configuração, namedValues não terá a chave esperada. Este método
     * detecta isso e loga um aviso antes de falhar.
     *
     * @param {Object} formEvent - Evento onFormSubmit (e)
     * @param {'PF'|'PJ'} tipo - Tipo identificado
     * @returns {{ valid: boolean, missingKeys: string[] }}
     */
    validateFormEvent(formEvent, tipo) {
        const headers = this._config.config.headers;
        const named = formEvent.namedValues || {};
        const isPF = tipo === 'PF';

        const requiredKeys = [
            headers[isPF ? 'nomePF' : 'nomeResponsavel'],
            headers[isPF ? 'docPF' : 'docPJ'],
            headers.telefone,
            headers.email,
            headers.endereco,
        ];

        const missingKeys = requiredKeys.filter(key => !(key in named));

        if (missingKeys.length > 0) {
            this._logger.warn(
                'FormService.validateFormEvent',
                `Campos ausentes no evento do Forms (${tipo}): [${missingKeys.join(', ')}]. ` +
                `Verifique se os nomes das perguntas no formulário batem com as ` +
                `configurações COL_* do tenant.`
            );
        }

        return {
            valid: missingKeys.length === 0,
            missingKeys,
        };
    }
}