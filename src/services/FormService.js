/**
 * @fileoverview Serviço para extração de dados do formulário.
 * Baseado no MÓDULO 9 (extrairDadosFormulario) e MÓDULO 9 (montarObjetoPessoa).
 */
class FormService {
  constructor(validator, formatter) {
    this._validator = validator;
    this._formatter = formatter;
  }

  // Extrai dados do array 'values' do evento onFormSubmit.
  // Lógica idêntica à função 'extrairDadosFormulario' do monolito.
  extrairDadosFormulario(valores, tipo) {
    const d = {tipo: tipo, isValid: false};

    if (tipo === 'Pessoa Física') {
      d.nome = valores[2] || '';
      d.sobrenome = valores[3] || '';
      d.documentoLimpo = this._formatter.apenasDigitos(valores[4]);
      d.logradouro = valores[5] || '';
      d.numero = valores[6] || '';
      d.complemento = valores[7] || '';
      d.telefoneLimpo = this._formatter.apenasDigitos(valores[8]);
      d.email = valores[9] || '';
      d.docTipo = 'CPF';
      d.empresa = ''; // Para PF, empresa é vazia
      d.isValid = this._validator.validarCPF(d.documentoLimpo);
    } else { // Pessoa Jurídica
      d.nome = valores[10] || ''; // Nome Responsável
      d.sobrenome = valores[11] || ''; // Sobrenome Responsável
      d.empresa = valores[12] || '';
      d.documentoLimpo = this._formatter.apenasDigitos(valores[13]);
      d.logradouro = valores[14] || '';
      d.numero = valores[15] || '';
      d.complemento = valores[16] || '';
      d.telefoneLimpo = this._formatter.apenasDigitos(valores[17]);
      d.email = valores[18] || '';
      d.docTipo = 'CNPJ';
      d.isValid = this._validator.validarCNPJ(d.documentoLimpo);
    }
    return d;
  }

  // Monta o objeto para a People API.
  // Lógica idêntica à função 'montarObjetoPessoa' do monolito.
  montarObjetoPessoa(d) {
    const p = {
      names: [{
        givenName: d.nome || '',
        familyName: d.sobrenome || '',
      }],
    };

    if (d.email) {
      p.emailAddresses = [{value: d.email, type: 'work'}];
    }

    const telFmt = this._formatter.telefone(d.telefoneLimpo);
    if (telFmt) {
      p.phoneNumbers = [{value: telFmt, type: 'work'}];
    }

    if (d.empresa) {
      p.organizations = [{name: d.empresa, type: 'work'}];
    }

    let enderecoCompleto = (d.logradouro || '');
    if (d.numero) enderecoCompleto += `, ${d.numero}`;
    if (d.complemento) enderecoCompleto += ` - ${d.complemento}`;

    if (enderecoCompleto.trim() !== '') {
      p.addresses = [{streetAddress: enderecoCompleto.trim(), type: 'work'}];
    }

    if (d.documentoLimpo && d.docTipo) {
      const docFormatado = d.isValid ?
        this._formatter.documento(d.documentoLimpo, d.docTipo) :
        d.documentoLimpo + ' [INVÁLIDO]';
      p.biographies = [{value: `${d.docTipo}: ${docFormatado}`}];
    }

    return p;
  }
}

if (typeof module !== 'undefined') {
  module.exports = FormService;
}
