/**
 * @fileoverview Mock da People API do GAS.
 */

'use strict';

const peopleMock = {
    People: {
        createContact: jest.fn((payload) => ({
            resourceName: `people/c${Date.now()}`,
            etag: `etag_${Date.now()}`,
            ...payload,
        })),
        get: jest.fn((resourceName) => ({
            resourceName,
            etag: 'etag_mock',
            names: [{ givenName: 'João', familyName: 'Silva' }],
            emailAddresses: [{ value: 'joao@teste.com' }],
            phoneNumbers: [{ value: '(11) 91234-5678' }],
            biographies: [{ value: 'CPF: 123.456.789-09' }],
        })),
        updateContact: jest.fn((payload) => ({
            ...payload,
            etag: `etag_updated_${Date.now()}`,
        })),
        Connections: {
            list: jest.fn(() => ({
                connections: [],
                nextSyncToken: `synctoken_${Date.now()}`,
            })),
        },
    },
    ContactGroups: {
        list: jest.fn(() => ({
            contactGroups: [
                {
                    name: 'PF', formattedName: 'PF',
                    resourceName: 'contactGroups/pf'
                },
                {
                    name: 'PJ', formattedName: 'PJ',
                    resourceName: 'contactGroups/pj'
                },
                {
                    name: 'revisar', formattedName: 'revisar',
                    resourceName: 'contactGroups/revisar'
                },
                {
                    name: 'novo-telefone', formattedName: 'novo-telefone',
                    resourceName: 'contactGroups/novo-telefone'
                },
                {
                    name: 'novo-email', formattedName: 'novo-email',
                    resourceName: 'contactGroups/novo-email'
                },
            ],
        })),
        create: jest.fn((payload) => ({
            resourceName: `contactGroups/${payload.contactGroup.name}`,
            name: payload.contactGroup.name,
        })),
        Members: {
            modify: jest.fn(),
        },
    },
    // Helper — reseta todos os mocks entre testes
    _reset: () => {
        Object.values(peopleMock.People).forEach(fn => {
            if (typeof fn.mockReset === 'function') fn.mockReset();
        });
        peopleMock.ContactGroups.list.mockReset();
        peopleMock.ContactGroups.create.mockReset();
        peopleMock.ContactGroups.Members.modify.mockReset();
    },
};

global.People = peopleMock;