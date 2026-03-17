/**
 * @fileoverview Funções utilitárias de formatação de dados.
 *
 * DECISÃO DE ARQUITETURA:
 * Formatter é uma classe estática (todos os métodos são estáticos)
 * porque formatação é uma função pura — sem estado, sem dependências
 * externas, testável diretamente sem instanciação.
 *
 * ⚠️ GAS RUNTIME: não há suporte a Intl.NumberFormat para CPF/CNPJ,
 * então as máscaras são aplicadas via regex puro.
 */
class Formatter {
    /**
     * Formata um número de telefone brasileiro.
     * Suporta celular (11 dígitos) e fixo (10 dígitos).
     * Números com outro tamanho são retornados sem formatação (sem erro).
     *
     * @param {string} tel - Telefone com apenas dígitos
     * @returns {string} Telefone formatado ou raw se tamanho inválido
     */
    static phone(tel) {
        if (!tel) return '';
        const digits = tel.replace(/\D/g, '');
        if (digits.length === 11) {
            return digits.replace(/^(\d{2})(\d{5})(\d{4})$/, '($1) $2-$3');
        }
        if (digits.length === 10) {
            return digits.replace(/^(\d{2})(\d{4})(\d{4})$/, '($1) $2-$3');
        }
        // Telefone com tamanho inesperado: retorna raw sem erro
        // 📋 FORMS: clientes podem preencher telefone fixo de 8 dígitos sem DDD
        return digits;
    }

    /**
     * Formata CPF ou CNPJ com a máscara padrão brasileira.
     * @param {string} doc - Documento com apenas dígitos
     * @param {'CPF'|'CNPJ'} tipo - Tipo do documento
     * @returns {string} Documento formatado, ou raw se não bater o padrão
     */
    static document(doc, tipo) {
        if (!doc) return '';
        if (tipo === 'CPF') {
            return doc.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
        }
        if (tipo === 'CNPJ') {
            return doc.replace(
                /^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/,
                '$1.$2.$3/$4-$5'
            );
        }
        return doc;
    }

    /**
     * Normaliza dígitos de um documento para comparação.
     * Remove tudo que não é dígito.
     * @param {string} value - Valor bruto (pode ter máscara)
     * @returns {string} Apenas dígitos
     */
    static digitsOnly(value) {
        return (value || '').toString().replace(/\D/g, '');
    }

    /**
     * Normaliza um e-mail para comparação case-insensitive.
     * @param {string} email - E-mail bruto
     * @returns {string} E-mail em lowercase sem espaços
     */
    static normalizeEmail(email) {
        return (email || '').toString().toLowerCase().trim();
    }
}