/**
 * @fileoverview Validação e identificação de documentos brasileiros (CPF/CNPJ).
 *
 * DECISÃO DE ARQUITETURA:
 * DocumentValidator é uma classe com métodos de instância (não estáticos)
 * para permitir injeção e mock nos testes — mesmo que internamente
 * não tenha estado, a consistência com o padrão do projeto facilita
 * substituição em testes de integração.
 *
 * Os algoritmos de validação são fiéis ao original mas reorganizados
 * com nomes de variáveis descritivos para legibilidade de portfólio.
 *
 * ⚠️ GAS RUNTIME: parseInt() e charAt() têm comportamento idêntico
 * ao Node.js no V8 runtime — sem surpresas aqui.
 */
class DocumentValidator {
  // ─────────────────────────────────────────────────────────────────────────
  // SEÇÃO 1: VALIDAÇÃO
  // ─────────────────────────────────────────────────────────────────────────

  /**
     * Valida um CPF pelo algoritmo oficial da Receita Federal.
     * Rejeita sequências de dígitos iguais (ex: 111.111.111-11).
     *
     * @param {string} cpf - CPF com apenas dígitos (11 caracteres)
     * @return {boolean}
     */
  validateCPF(cpf) {
    if (!cpf || cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;

    // Primeiro dígito verificador
    let sum = 0;
    for (let i = 0; i < 9; i++) {
      sum += parseInt(cpf.charAt(i)) * (10 - i);
    }
    let remainder = 11 - (sum % 11);
    if (remainder === 10 || remainder === 11) remainder = 0;
    if (remainder !== parseInt(cpf.charAt(9))) return false;

    // Segundo dígito verificador
    sum = 0;
    for (let i = 0; i < 10; i++) {
      sum += parseInt(cpf.charAt(i)) * (11 - i);
    }
    remainder = 11 - (sum % 11);
    if (remainder === 10 || remainder === 11) remainder = 0;
    if (remainder !== parseInt(cpf.charAt(10))) return false;

    return true;
  }

  /**
     * Valida um CNPJ pelo algoritmo oficial da Receita Federal.
     * Rejeita sequências de dígitos iguais (ex: 11.111.111/1111-11).
     * CNPJs de empresas extintas continuam matematicamente válidos.
     *
     * @param {string} cnpj - CNPJ com apenas dígitos (14 caracteres)
     * @return {boolean}
     */
  validateCNPJ(cnpj) {
    if (!cnpj || cnpj.length !== 14 || /^(\d)\1{13}$/.test(cnpj)) return false;

    // Primeiro dígito verificador
    let length = cnpj.length - 2;
    let numbers = cnpj.substring(0, length);
    const digits = cnpj.substring(length);
    let sum = 0;
    let pos = length - 7;

    for (let i = length; i >= 1; i--) {
      sum += parseInt(numbers.charAt(length - i)) * pos--;
      if (pos < 2) pos = 9;
    }
    let result = sum % 11 < 2 ? 0 : 11 - (sum % 11);
    if (result !== parseInt(digits.charAt(0))) return false;

    // Segundo dígito verificador
    length += 1;
    numbers = cnpj.substring(0, length);
    sum = 0;
    pos = length - 7;

    for (let i = length; i >= 1; i--) {
      sum += parseInt(numbers.charAt(length - i)) * pos--;
      if (pos < 2) pos = 9;
    }
    result = sum % 11 < 2 ? 0 : 11 - (sum % 11);
    if (result !== parseInt(digits.charAt(1))) return false;

    return true;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // SEÇÃO 2: IDENTIFICAÇÃO AUTOMÁTICA
  // ─────────────────────────────────────────────────────────────────────────

  /**
     * Identifica o tipo e valida um documento a partir de uma string bruta.
     * Extrai apenas os dígitos antes de tentar identificar.
     *
     * Usado no fluxo de correção pelo operador: o operador digita apenas
     * os números no campo de notas do Google Contacts e o sistema identifica
     * automaticamente se é CPF (11 dígitos) ou CNPJ (14 dígitos).
     *
     * @param {string} rawValue - Valor bruto (pode ter máscara ou texto misto)
     * @return {DocumentIdentificationResult}
     */
  identify(rawValue) {
    const digits = (rawValue || '').replace(/\D/g, '');

    if (digits.length === 11) {
      const valid = this.validateCPF(digits);
      return {digits, type: 'CPF', valid, ambiguous: false};
    }

    if (digits.length === 14) {
      const valid = this.validateCNPJ(digits);
      return {digits, type: 'CNPJ', valid, ambiguous: false};
    }

    // Tamanho não corresponde a CPF nem CNPJ
    return {digits, type: null, valid: false, ambiguous: digits.length === 0};
  }

  /**
     * Detecta se um texto do campo de notas foi editado manualmente
     * pelo operador (apenas dígitos, sem prefixo "CPF:" ou "CNPJ:").
     *
     * 📋 CONTACTS: o campo biography é o único campo monitorado pelo
     * sistema no Google Contacts. Quando o operador apaga o texto
     * e digita só os números, este método detecta esse padrão.
     *
     * @param {string} biographyValue - Conteúdo atual do campo de notas
     * @return {boolean} true se parece correção manual do operador
     */
  isOperatorCorrection(biographyValue) {
    const text = (biographyValue || '').trim();
    if (!text) return false;

    const hasPrefix = /^(CPF|CNPJ)\s*:/i.test(text);
    if (hasPrefix) return false;

    const digits = text.replace(/\D/g, '');
    const isValidLength = digits.length === 11 || digits.length === 14;

    // Aceita dígitos com espaços ou hífens acidentais (ex: "338 655 67878")
    // mas rejeita texto com palavras (ex: "meu cpf é 12345678901")
    const hasOnlyDigitsAndSeparators = /^[\d\s\-\.\/]+$/.test(text);

    return isValidLength && hasOnlyDigitsAndSeparators;
  }
}

/**
 * @typedef {Object} DocumentIdentificationResult
 * @property {string} digits - Apenas os dígitos extraídos
 * @property {'CPF'|'CNPJ'|null} type - Tipo identificado pelo tamanho
 * @property {boolean} valid - Se passou na validação matemática
 * @property {boolean} ambiguous - true se não foi possível identificar o tipo
 */
