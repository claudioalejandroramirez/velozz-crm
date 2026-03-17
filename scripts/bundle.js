#!/usr/bin/env node
/**
 * @fileoverview Pipeline de bundle para o Velozz CRM.
 * v1.1 — Fix: readGitVersion stdio array não suportado por execSync em
 *         todas as versões do Node; simplificado para encoding+try/catch.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC_DIR = path.join(ROOT, 'src');
const DIST_DIR = path.join(ROOT, 'dist');

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

const HTML_FILES = [
  ['ui/SetupTenantDialog.html', 'SetupTenantDialog.html'],
];

const CONFIG_FILES = ['appsscript.json'];

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Lê a versão do package.json.
 * @return {string}
 */
function readVersion() {
  const pkg = JSON.parse(
      fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'),
  );
  return pkg.version || '0.0.0';
}

/**
 * FIX 5: readGitVersion simplificado.
 *
 * PROBLEMA ORIGINAL:
 * `execSync` com `stdio: ['pipe', 'pipe', 'ignore']` (array) não é suportado
 * de forma confiável em todas as versões do Node.js para execSync — esse
 * formato é próprio de `spawn`. Em alguns ambientes, o retorno era undefined
 * em vez do stdout, causando `.toString()` em undefined → TypeError.
 *
 * SOLUÇÃO:
 * Usar `{ encoding: 'utf8' }` — execSync retorna string diretamente.
 * Stderr vai para o terminal (aceitável em CI — vira log da action).
 * Se o comando falhar (repo sem tags), o catch retorna readVersion().
 *
 * @return {string}
 */
function readGitVersion() {
  try {
    const {execSync} = require('child_process');
    const tag = execSync('git describe --tags --abbrev=0', {
      cwd: ROOT,
      encoding: 'utf8',
      // 'pipe' captura stderr em vez de imprimir — evita ruído no CI
      // mas não quebra se o comando falhar (catch cuida disso)
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    return tag || readVersion();
  } catch (_) {
    // Repo sem tags ainda (primeira execução, por exemplo)
    return readVersion();
  }
}

/**
 * Garante que dist/ existe e limpa artefatos de builds anteriores.
 * Remove .gs, .html e bundle-manifest.json (mas preserva .clasp.json se houver).
 */
function prepareDist() {
  if (fs.existsSync(DIST_DIR)) {
    fs.readdirSync(DIST_DIR).forEach((file) => {
      if (
        file.endsWith('.gs') ||
                file.endsWith('.html') ||
                file === 'bundle-manifest.json'
      ) {
        fs.unlinkSync(path.join(DIST_DIR, file));
      }
    });
  } else {
    fs.mkdirSync(DIST_DIR, {recursive: true});
  }
}

/**
 * Aplica transformações no conteúdo .js antes de gerar .gs.
 * @param {string} content
 * @param {string} fileName
 * @param {string} version
 * @return {string}
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
  result = result.replace(/\{\{VERSION\}\}/g, version);
  result = result.replace(/^export\s+(default\s+)?/gm, '');
  result = result.replace(/^import\s+.*?from\s+['"].*?['"]\s*;?\s*$/gm, '');

  return banner + result;
}

// ─────────────────────────────────────────────────────────────────────────────
// VALIDAÇÃO PRÉ-BUNDLE
// Verifica que todos os arquivos fonte existem ANTES de começar,
// evitando bundle parcialmente gerado em caso de arquivo faltando.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Valida que todos os arquivos necessários existem.
 * @return {{ valid: boolean, missing: string[] }}
 */
function validateSources() {
  const missing = [];

  BUNDLE_ORDER.forEach(([, srcRelative]) => {
    const srcPath = path.join(SRC_DIR, srcRelative);
    if (!fs.existsSync(srcPath)) missing.push(`src/${srcRelative}`);
  });

  HTML_FILES.forEach(([srcRelative]) => {
    const srcPath = path.join(SRC_DIR, srcRelative);
    if (!fs.existsSync(srcPath)) missing.push(`src/${srcRelative}`);
  });

  CONFIG_FILES.forEach((fileName) => {
    const srcPath = path.join(ROOT, fileName);
    if (!fs.existsSync(srcPath)) missing.push(fileName);
  });

  return {valid: missing.length === 0, missing};
}

// ─────────────────────────────────────────────────────────────────────────────
// PIPELINE PRINCIPAL
// ─────────────────────────────────────────────────────────────────────────────

function bundle() {
  console.log('\n⚡ Velozz CRM — Bundle iniciado\n');

  const version = readGitVersion();
  console.log(`📦 Versão: ${version}`);

  // Valida fontes antes de qualquer escrita em disco
  const {valid, missing} = validateSources();
  if (!valid) {
    console.error('\n❌ Arquivos fonte ausentes:');
    missing.forEach((f) => console.error(`   • ${f}`));
    console.error('\nVerifique se todos os blocos foram criados em src/\n');
    process.exit(1);
  }

  prepareDist();
  console.log(`🗂️  dist/ preparado: ${DIST_DIR}\n`);

  let successCount = 0;
  const errors = [];

  // ── 1. JS → .gs ────────────────────────────────────────────────────
  console.log('📝 Processando arquivos JS:');
  BUNDLE_ORDER.forEach(([, srcRelative, distName]) => {
    const srcPath = path.join(SRC_DIR, srcRelative);
    const distPath = path.join(DIST_DIR, distName);
    try {
      const raw = fs.readFileSync(srcPath, 'utf8');
      const transformed = transform(raw, distName, version);
      fs.writeFileSync(distPath, transformed, 'utf8');
      console.log(`  ✓ ${srcRelative.padEnd(45)} → dist/${distName}`);
      successCount++;
    } catch (err) {
      console.error(`  ✗ ${srcRelative.padEnd(45)} → ERRO: ${err.message}`);
      errors.push({file: srcRelative, error: err.message});
    }
  });

  // ── 2. HTML (cópia direta) ──────────────────────────────────────────
  console.log('\n📄 Copiando arquivos HTML:');
  HTML_FILES.forEach(([srcRelative, distName]) => {
    const srcPath = path.join(SRC_DIR, srcRelative);
    const distPath = path.join(DIST_DIR, distName);
    try {
      fs.copyFileSync(srcPath, distPath);
      console.log(`  ✓ ${srcRelative.padEnd(45)} → dist/${distName}`);
      successCount++;
    } catch (err) {
      console.error(`  ✗ ${srcRelative.padEnd(45)} → ERRO: ${err.message}`);
      errors.push({file: srcRelative, error: err.message});
    }
  });

  // ── 3. Config GAS ──────────────────────────────────────────────────
  console.log('\n⚙️  Copiando configuração GAS:');
  CONFIG_FILES.forEach((fileName) => {
    const srcPath = path.join(ROOT, fileName);
    const distPath = path.join(DIST_DIR, fileName);
    try {
      fs.copyFileSync(srcPath, distPath);
      console.log(`  ✓ ${fileName}`);
      successCount++;
    } catch (err) {
      console.error(`  ✗ ${fileName} → ERRO: ${err.message}`);
      errors.push({file: fileName, error: err.message});
    }
  });

  // ── 4. Manifesto ───────────────────────────────────────────────────
  const manifest = {
    version,
    generatedAt: new Date().toISOString(),
    nodeVersion: process.version,
    files: BUNDLE_ORDER.map(([, src, dist]) => ({src, dist})),
    htmlFiles: HTML_FILES.map(([src, dist]) => ({src, dist})),
  };
  fs.writeFileSync(
      path.join(DIST_DIR, 'bundle-manifest.json'),
      JSON.stringify(manifest, null, 2),
      'utf8',
  );

  // ── 5. Relatório ───────────────────────────────────────────────────
  console.log('\n' + '─'.repeat(60));
  if (errors.length === 0) {
    console.log(`✅ Bundle concluído: ${successCount} arquivo(s) gerado(s)`);
    console.log(`📁 Saída: ${DIST_DIR}`);
    console.log('🚀 Próximo passo: npm run deploy\n');
    process.exit(0);
  } else {
    console.error(`\n❌ Bundle com erros: ${errors.length} falha(s)`);
    errors.forEach(({file, error}) => {
      console.error(`   • ${file}: ${error}`);
    });
    process.exit(1);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// BUMP VERSION (gerado automaticamente)
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
let v;
if (type === 'major')      v = \`\${major + 1}.0.0\`;
else if (type === 'minor') v = \`\${major}.\${minor + 1}.0\`;
else                       v = \`\${major}.\${minor}.\${patch + 1}\`;
pkg.version = v;
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\\n', 'utf8');
console.log(\`✅ Versão atualizada: \${v}\`);
`;
  fs.writeFileSync(bumpPath, content, 'utf8');
  console.log('📝 scripts/bump-version.js gerado automaticamente.');
}

generateBumpVersionScript();
bundle();
