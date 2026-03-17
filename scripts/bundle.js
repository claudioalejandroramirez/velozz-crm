#!/usr/bin/env node
/**
 * @fileoverview Pipeline de bundle para o Velozz CRM.
 *
 * O GAS V8 não suporta módulos ES (import/export). Este script lê os
 * arquivos src/ em ordem definida, aplica transformações e gera os
 * arquivos .gs em dist/ que o clasp vai fazer push.
 *
 * ORDEM DE BUNDLE (crítica — classes devem ser declaradas antes de uso):
 *   0. AppConfig          ← sem dependências
 *   1. Logger             ← depende de AppConfig
 *   2. LockManager        ← depende de AppConfig, Logger
 *   3. Formatter          ← sem dependências (estático)
 *   4. DocumentValidator  ← sem dependências
 *   5. SheetService       ← depende de AppConfig, Logger
 *   6. FormService        ← depende de AppConfig, Logger, SheetService,
 *                            DocumentValidator, Formatter
 *   7. TagService         ← depende de AppConfig, Logger
 *   8. ContactService     ← depende de AppConfig, Logger
 *   9. SyncOrchestrator   ← depende de todos os services
 *  10. TriggerHandlers    ← depende de tudo (entry point GAS)
 *
 * ⚠️ GAS RUNTIME: arquivos HTML não são processados pelo bundle —
 * são copiados diretamente para dist/ sem transformação.
 */

'use strict';

const fs = require('fs');
const path = require('path');

// ─────────────────────────────────────────────────────────────────────────────
// CONFIGURAÇÃO DO BUNDLE
// ─────────────────────────────────────────────────────────────────────────────

const ROOT = path.resolve(__dirname, '..');
const SRC_DIR = path.join(ROOT, 'src');
const DIST_DIR = path.join(ROOT, 'dist');

/**
 * Ordem de bundle: [índice, arquivo fonte, nome do arquivo .gs gerado]
 * O índice numérico no nome garante a ordem de carregamento no GAS.
 */
const BUNDLE_ORDER = [
    ['00', 'config/AppConfig.js', '00_AppConfig.gs'],
    ['01', 'utils/Logger.js', '01_Logger.gs'],
    ['02', 'utils/LockManager.js', '02_LockManager.gs'],
    ['03', 'utils/Formatter.js', '03_Formatter.gs'],
    ['04', 'validators/DocumentValidator.js', '04_DocumentValidator.gs'],
    ['05', 'services/SheetService.js', '05_SheetService.gs'],
    ['06', 'services/FormService.js', '06_FormService.gs'],
    ['07', 'services/TagService.js', '07_TagService.gs'],
    ['08', 'services/ContactService.js', '08_ContactService.gs'],
    ['09', 'services/SyncOrchestrator.js', '09_SyncOrchestrator.gs'],
    ['10', 'triggers/TriggerHandlers.js', '10_TriggerHandlers.gs'],
];

/**
 * Arquivos HTML a copiar (sem transformação).
 * O nome do arquivo .html deve coincidir com o usado em
 * HtmlService.createHtmlOutputFromFile() em TriggerHandlers.js.
 */
const HTML_FILES = [
    ['ui/SetupTenantDialog.html', 'SetupTenantDialog.html'],
];

/**
 * Arquivos de configuração do GAS a copiar para dist/.
 */
const CONFIG_FILES = [
    'appsscript.json',
];

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Lê a versão atual do package.json para substituir {{VERSION}}.
 * @returns {string}
 */
function readVersion() {
    const pkg = JSON.parse(
        fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')
    );
    return pkg.version || '0.0.0';
}

/**
 * Lê a git tag atual se disponível, fallback para versão do package.json.
 * Usado para substituir {{VERSION}} nos arquivos gerados.
 * @returns {string}
 */
function readGitVersion() {
    try {
        const { execSync } = require('child_process');
        const tag = execSync('git describe --tags --abbrev=0 2>/dev/null', {
            cwd: ROOT,
            stdio: ['pipe', 'pipe', 'ignore'],
        }).toString().trim();
        return tag || readVersion();
    } catch (_) {
        return readVersion();
    }
}

/**
 * Garante que o diretório dist/ existe e está limpo.
 */
function prepareDist() {
    if (fs.existsSync(DIST_DIR)) {
        // Remove apenas arquivos .gs e .html — preserva appsscript.json se existir
        fs.readdirSync(DIST_DIR).forEach(file => {
            if (file.endsWith('.gs') || file.endsWith('.html')) {
                fs.unlinkSync(path.join(DIST_DIR, file));
            }
        });
    } else {
        fs.mkdirSync(DIST_DIR, { recursive: true });
    }
}

/**
 * Aplica transformações no conteúdo de um arquivo .js antes de gerar .gs.
 *
 * Transformações aplicadas:
 * 1. Substitui {{VERSION}} pela versão atual do git/package.json
 * 2. Adiciona banner de cabeçalho com metadados do arquivo
 * 3. Remove linhas de import/export residuais (segurança)
 *
 * ⚠️ NÃO faz transpilação de ES6 — o GAS V8 suporta ES6 nativamente.
 * ⚠️ NÃO faz minificação — o editor GAS precisa do código legível para debug.
 *
 * @param {string} content - Conteúdo bruto do arquivo .js
 * @param {string} fileName - Nome do arquivo (para o banner)
 * @param {string} version - Versão atual
 * @returns {string} Conteúdo transformado
 */
function transform(content, fileName, version) {
    const banner = [
        '// ══════════════════════════════════════════════════════════════════════',
        `// Velozz CRM — ${fileName}`,
        `// Gerado em: ${new Date().toISOString()}`,
        `// Versão: ${version}`,
        '// NÃO EDITAR MANUALMENTE — gerado por scripts/bundle.js',
        '// ══════════════════════════════════════════════════════════════════════',
        '',
    ].join('\n');

    let result = content;

    // 1. Substitui placeholder de versão
    result = result.replace(/\{\{VERSION\}\}/g, version);

    // 2. Remove import/export residuais (não suportados pelo GAS)
    result = result.replace(/^export\s+(default\s+)?/gm, '');
    result = result.replace(/^import\s+.*?from\s+['"].*?['"]\s*;?\s*$/gm, '');

    return banner + result;
}

// ─────────────────────────────────────────────────────────────────────────────
// PIPELINE PRINCIPAL
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Executa o bundle completo.
 */
function bundle() {
    console.log('\n⚡ Velozz CRM — Bundle iniciado\n');

    const version = readGitVersion();
    console.log(`📦 Versão: ${version}`);

    prepareDist();
    console.log(`🗂️  dist/ preparado: ${DIST_DIR}\n`);

    let successCount = 0;
    const errors = [];

    // ── 1. Processa arquivos JS → .gs ───────────────────────────────────
    console.log('📝 Processando arquivos JS:');
    BUNDLE_ORDER.forEach(([, srcRelative, distName]) => {
        const srcPath = path.join(SRC_DIR, srcRelative);
        const distPath = path.join(DIST_DIR, distName);

        try {
            if (!fs.existsSync(srcPath)) {
                throw new Error(`Arquivo não encontrado: ${srcPath}`);
            }
            const raw = fs.readFileSync(srcPath, 'utf8');
            const transformed = transform(raw, distName, version);
            fs.writeFileSync(distPath, transformed, 'utf8');
            console.log(`  ✓ ${srcRelative.padEnd(45)} → dist/${distName}`);
            successCount++;
        } catch (err) {
            console.error(`  ✗ ${srcRelative.padEnd(45)} → ERRO: ${err.message}`);
            errors.push({ file: srcRelative, error: err.message });
        }
    });

    // ── 2. Copia arquivos HTML ──────────────────────────────────────────
    console.log('\n📄 Copiando arquivos HTML:');
    HTML_FILES.forEach(([srcRelative, distName]) => {
        const srcPath = path.join(SRC_DIR, srcRelative);
        const distPath = path.join(DIST_DIR, distName);

        try {
            if (!fs.existsSync(srcPath)) {
                throw new Error(`Arquivo não encontrado: ${srcPath}`);
            }
            fs.copyFileSync(srcPath, distPath);
            console.log(`  ✓ ${srcRelative.padEnd(45)} → dist/${distName}`);
            successCount++;
        } catch (err) {
            console.error(`  ✗ ${srcRelative.padEnd(45)} → ERRO: ${err.message}`);
            errors.push({ file: srcRelative, error: err.message });
        }
    });

    // ── 3. Copia arquivos de configuração GAS ───────────────────────────
    console.log('\n⚙️  Copiando configuração GAS:');
    CONFIG_FILES.forEach(fileName => {
        const srcPath = path.join(ROOT, fileName);
        const distPath = path.join(DIST_DIR, fileName);

        try {
            if (!fs.existsSync(srcPath)) {
                throw new Error(`Arquivo não encontrado: ${srcPath}`);
            }
            fs.copyFileSync(srcPath, distPath);
            console.log(`  ✓ ${fileName}`);
            successCount++;
        } catch (err) {
            console.error(`  ✗ ${fileName} → ERRO: ${err.message}`);
            errors.push({ file: fileName, error: err.message });
        }
    });

    // ── 4. Gera manifesto do bundle ─────────────────────────────────────
    const manifest = {
        version,
        generatedAt: new Date().toISOString(),
        files: BUNDLE_ORDER.map(([, src, dist]) => ({ src, dist })),
        htmlFiles: HTML_FILES.map(([src, dist]) => ({ src, dist })),
    };
    fs.writeFileSync(
        path.join(DIST_DIR, 'bundle-manifest.json'),
        JSON.stringify(manifest, null, 2),
        'utf8'
    );

    // ── 5. Relatório final ──────────────────────────────────────────────
    console.log('\n' + '─'.repeat(60));
    if (errors.length === 0) {
        console.log(`✅ Bundle concluído: ${successCount} arquivo(s) gerado(s)`);
        console.log(`📁 Saída: ${DIST_DIR}`);
        console.log('🚀 Próximo passo: npm run deploy\n');
        process.exit(0);
    } else {
        console.error(`\n❌ Bundle com erros: ${errors.length} falha(s)`);
        errors.forEach(({ file, error }) => {
            console.error(`   • ${file}: ${error}`);
        });
        console.error('\nCorriga os erros acima antes de fazer deploy.\n');
        process.exit(1);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// SCRIPT AUXILIAR: bump-version.js (referenciado no package.json)
// Gera scripts/bump-version.js automaticamente se não existir
// ─────────────────────────────────────────────────────────────────────────────

function generateBumpVersionScript() {
    const bumpPath = path.join(__dirname, 'bump-version.js');
    if (fs.existsSync(bumpPath)) return;

    const content = `#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const pkgPath = path.resolve(__dirname, '..', 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
const [major, minor, patch] = pkg.version.split('.').map(Number);
const type = process.argv[2] || 'patch';
let newVersion;
if (type === 'major') newVersion = \`\${major + 1}.0.0\`;
else if (type === 'minor') newVersion = \`\${major}.\${minor + 1}.0\`;
else newVersion = \`\${major}.\${minor}.\${patch + 1}\`;
pkg.version = newVersion;
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\\n', 'utf8');
console.log(\`✅ Versão atualizada: \${newVersion}\`);
`;
    fs.writeFileSync(bumpPath, content, 'utf8');
    console.log('📝 scripts/bump-version.js gerado automaticamente.');
}

// ─────────────────────────────────────────────────────────────────────────────
// ENTRY POINT
// ─────────────────────────────────────────────────────────────────────────────

generateBumpVersionScript();
bundle();
