/**
 * @fileoverview Fábrica centralizada de objetos de teste.
 *
 * DECISÃO: centralizar criação de dados de teste evita duplicação e
 * garante que mudanças na estrutura de dados (ex: novo campo em FormData)
 * sejam refletidas em todos os testes automaticamente.
 */

'use strict';

class TestFactory {
    // ─────────────────────────────────────────────────────────────────────
    // FormData
    // ─────────────────────────────────────────────────────────────────────

    /**
     * Cria um FormData válido de Pessoa Física.
     * @param {Object} [overrides] - Campos a sobrescrever
     * @returns {Object}
     */
    static validPF(overrides = {}) {
        return {
            tipo: 'PF',
            isPF: true,
            nome: 'João',
            sobrenome: 'Silva',
            empresa: '',
            documentoLimpo: '52998224725', // CPF matematicamente válido
            docTipo: 'CPF',
            logradouro: 'Rua das Flores',
            numero: '123',
            complemento: 'Apto 4',
            telefoneLimpo: '11912345678',
            email: 'joao@teste.com',
            isValid: true,
            ...overrides,
        };
    }

    /**
     * Cria um FormData válido de Pessoa Jurídica.
     * @param {Object} [overrides]
     * @returns {Object}
     */
    static validPJ(overrides = {}) {
        return {
            tipo: 'PJ',
            isPF: false,
            nome: 'Maria',
            sobrenome: '',
            empresa: 'Acme Ltda',
            documentoLimpo: '11222333000181', // CNPJ matematicamente válido
            docTipo: 'CNPJ',
            logradouro: 'Av. Paulista',
            numero: '1000',
            complemento: 'Sala 5',
            telefoneLimpo: '1133334444',
            email: 'contato@acme.com',
            isValid: true,
            ...overrides,
        };
    }

    /**
     * Cria um FormData de PF com DOC inválido.
     * @returns {Object}
     */
    static invalidDocPF() {
        return TestFactory.validPF({
            documentoLimpo: '12345678900',
            isValid: false,
        });
    }

    // ─────────────────────────────────────────────────────────────────────
    // Eventos de formulário (onFormSubmit)
    // ─────────────────────────────────────────────────────────────────────

    /**
     * Cria um evento onFormSubmit simulado para PF.
     * @param {Object} [overrides] - Sobrescreve campos de namedValues
     * @returns {Object}
     */
    static formEventPF(overrides = {}) {
        return {
            namedValues: {
                'Data': ['16/03/2026'],
                'Tipo': ['Pessoa Física'],
                'Nome': ['João'],
                'Sobrenome': ['Silva'],
                'CPF': ['529.982.247-25'],
                'Endereço': ['Rua das Flores'],
                'Número': ['123'],
                'Complemento': ['Apto 4'],
                'Telefone': ['(11) 91234-5678'],
                'Email': ['joao@teste.com'],
                ...overrides,
            },
            values: [
                '16/03/2026', 'Pessoa Física', 'João', 'Silva',
                '529.982.247-25', 'Rua das Flores', '123', 'Apto 4',
                '(11) 91234-5678', 'joao@teste.com',
            ],
        };
    }

    /**
     * Cria um evento onFormSubmit simulado para PJ.
     * @param {Object} [overrides]
     * @returns {Object}
     */
    static formEventPJ(overrides = {}) {
        return {
            namedValues: {
                'Data': ['16/03/2026'],
                'Tipo': ['Pessoa Jurídica'],
                'Nome Responsável': ['Maria'],
                'Empresa': ['Acme Ltda'],
                'CNPJ': ['11.222.333/0001-81'],
                'Endereço': ['Av. Paulista'],
                'Número': ['1000'],
                'Complemento': ['Sala 5'],
                'Telefone': ['(11) 3333-4444'],
                'Email': ['contato@acme.com'],
                ...overrides,
            },
            values: [],
        };
    }

    // ─────────────────────────────────────────────────────────────────────
    // AppConfig mock
    // ─────────────────────────────────────────────────────────────────────

    /**
     * Cria uma instância de AppConfig com defaults puros (sem PropertiesService).
     * @param {Object} [overrideProps]
     * @returns {AppConfig}
     */
    static appConfig(overrideProps = {}) {
        // Requer que AppConfig esteja disponível no escopo (carregado pelo Jest)
        const props = { ...AppConfig.DEFAULTS, ...overrideProps };
        return new AppConfig(props);
    }

    // ─────────────────────────────────────────────────────────────────────
    // Contato da People API
    // ─────────────────────────────────────────────────────────────────────

    /**
     * Cria um objeto contato simulado da People API.
     * @param {Object} [overrides]
     * @returns {Object}
     */
    static contact(overrides = {}) {
        return {
            resourceName: 'people/c123456789',
            etag: 'etag_test_001',
            names: [{ givenName: 'João', familyName: 'Silva' }],
            emailAddresses: [{ value: 'joao@teste.com', type: 'work' }],
            phoneNumbers: [{ value: '(11) 91234-5678', type: 'work' }],
            biographies: [{ value: 'CPF: 529.982.247-25' }],
            ...overrides,
        };
    }
}

module.exports = { TestFactory };