/**
 * @fileoverview Gerenciador de locks para evitar condições de corrida.
 */
class LockManager {
  constructor(logger, lockService) {
    this._logger = logger;
    this._lockService = lockService || LockService;
  }

  withLock(fn, onLockFailed, context, timeoutMs = 10000) {
    const lock = this._lockService.getScriptLock();
    const acquired = lock.tryLock(timeoutMs);

    if (!acquired) {
      this._logger.warn(
        'LockManager',
        `Lock não obtido após ${timeoutMs}ms${context ? ` | contexto: ${context}` : ''}`
      );
      if (typeof onLockFailed === 'function') onLockFailed();
      return undefined;
    }

    try {
      return fn();
    } finally {
      lock.releaseLock();
    }
  }
}

if (typeof module !== 'undefined') {
  module.exports = LockManager;
}