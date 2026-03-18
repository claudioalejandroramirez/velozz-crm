/**
 * @fileoverview Fábrica centralizada de objetos de teste.
 */

'use strict';

const { AppConfig } = require('../../src/config/AppConfig');

class TestFactory {
    static validPF(overrides = {}) {
        return {
            tipo: 'Pessoa Física',
            isPF: true,
            nome: 'João',
            sobrenome: 'Silva',
            empresa: '',
            documentoLimpo: '52998224725',
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

    static validPJ(overrides = {}) {
        return {
            tipo: 'Pessoa Jurídica',
            isPF: false,
            nome: 'Maria',
            sobrenome: 'Silva',
            empresa: 'Acme Ltda',
            documentoLimpo: '11222333000181',
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

    static invalidDocPF() {
        return TestFactory.validPF({
            documentoLimpo: '12345678900',
            isValid: false,
        });
    }

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
            range: {
                getRow: () => 2,
                getSheet: () => ({ getName: () => 'Respostas ao formulário 1' })
            }
        };
    }

    static formEventPJ(overrides = {}) {
        return {
            namedValues: {
                'Data': ['16/03/2026'],
                'Tipo': ['Pessoa Jurídica'],
                'Nome Responsável': ['Maria'],
                'Sobrenome Responsável': ['Silva'],
                'Empresa': ['Acme Ltda'],
                'CNPJ': ['11.222.333/0001-81'],
                'Endereço': ['Av. Paulista'],
                'Número': ['1000'],
                'Complemento': ['Sala 5'],
                'Telefone': ['(11) 3333-4444'],
                'Email': ['contato@acme.com'],
                ...overrides,
            },
            values: [
                '16/03/2026', 'Pessoa Jurídica',
                '', '', '', '', '', '', '', '',
                'Maria', 'Silva', 'Acme Ltda',
                '11.222.333/0001-81',
                'Av. Paulista', '1000', 'Sala 5',
                '(11) 3333-4444', 'contato@acme.com'
            ],
            range: {
                getRow: () => 2,
                getSheet: () => ({ getName: () => 'Respostas ao formulário 1' })
            }
        };
    }

    static appConfig(overrideProps = {}) {
        const props = { ...AppConfig.DEFAULTS, ...overrideProps };
        return new AppConfig(PropertiesService.getScriptProperties());
    }

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