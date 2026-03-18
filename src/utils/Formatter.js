/**
 * @fileoverview Funções de formatação (extraído do MÓDULO 9).
 */
class Formatter {
  static telefone(tel) {
    if (!tel) return '';
    const digits = tel.toString().replace(/\D/g, '');
    if (digits.length === 11) {
      return digits.replace(/^(\d{2})(\d{5})(\d{4})$/, '($1) $2-$3');
    }
    if (digits.length === 10) {
      return digits.replace(/^(\d{2})(\d{4})(\d{4})$/, '($1) $2-$3');
    }
    return digits; // Retorna só os dígitos se não for 10 ou 11
  }

  static documento(doc, tipo) {
    if (!doc) return '';
    if (tipo === 'CPF') {
      return doc.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
    }
    if (tipo === 'CNPJ') {
      return doc.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
    }
    return doc;
  }

  static apenasDigitos(valor) {
    return (valor || '').toString().replace(/\D/g, '');
  }

  static normalizarEmail(email) {
    return (email || '').toString().toLowerCase().trim();
  }
}

if (typeof module !== 'undefined') {
  module.exports = Formatter;
}
