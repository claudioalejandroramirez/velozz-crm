/**
 * @fileoverview Wrapper do LockService do GAS.
 *
 * DECISÃO DE ARQUITETURA:
 * O padrão withLock() encapsula o try/finally obrigatório para release,
 * eliminando o risco de esquecer de liberar o lock em caso de exceção.
 * Todas as funções críticas (processarFormulario, syncPlanilhaParaContatos)
 * usam withLock() em vez de gerenciar o lock manualmente.
 *
 * ⚠️ GAS RUNTIME: LockService.getScriptLock() é compartilhado entre
 * todas as execuções simultâneas do projeto (todos os usuários).
 * Timeout de 10s é conservador — ajustável via LOCK_TIMEOUT_MS no tenant.
 */
class LockManager {
  /**
     * @param {AppConfig} appConfig - Instância de configuração do tenant
     * @param {Logger} logger - Instância do logger
     * @param {Object} [lockService] - Injetado para testes (padrão: LockService)
     */
  constructor(appConfig, logger, lockService) {
    this._config = appConfig;
    this._logger = logger;
    this._lockService = lockService || LockService;
  }

  /**
     * Executa uma função dentro de um lock exclusivo do script.
     * Se o lock não for obtido dentro do timeout, chama onLockFailed().
     *
     * @param {Function} fn - Função a executar com o lock
     * @param {Function} [onLockFailed] - Callback se o lock não for obtido
     * @param {string} [context] - Contexto para o log (ex: nome da função)
     * @return {*} Retorno de fn(), ou undefined se o lock falhou
     */
  withLock(fn, onLockFailed, context) {
    const timeoutMs = this._config.config.lockTimeoutMs;
    const lock = this._lockService.getScriptLock();
    const acquired = lock.tryLock(timeoutMs);

    if (!acquired) {
      this._logger.warn(
          'LockManager',
          `Lock não obtido após ${timeoutMs}ms${context ? ` | contexto: ${context}` : ''}`,
      );
      if (typeof onLockFailed === 'function') onLockFailed();
      return undefined;
    }

    try {
      return fn();
    } finally {
      // ⚠️ GAS RUNTIME: releaseLock() DEVE estar no finally.
      // Se estiver só no try, uma exceção deixa o lock preso até expirar.
      lock.releaseLock();
    }
  }
}
