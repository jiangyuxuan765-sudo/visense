(function (window) {
  'use strict';

  var DATABASE = 'visense-v1';
  var STORE = 'kv';
  var KEY = 'workspace';
  var FORMAT = 'VisenseStore/1';
  var db = null;
  var local = null;
  var mode = 'memory';
  var ready = null;
  var queue = Promise.resolve();
  var lastStamp = 0;
  var cached = null;

  function copy(value) {
    return value === null ? null : JSON.parse(JSON.stringify(value));
  }

  function enqueue(operation) {
    var result = queue.then(operation);
    queue = result.catch(function () {});
    return result;
  }

  function storageError(error, action) {
    var name = error && error.name;
    var message;
    if (name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED') {
      message = '设备存储空间不足，未能' + action + '。请减少导入图片的大小或释放浏览器存储空间后重试。';
    } else if (name === 'SecurityError' || name === 'InvalidStateError') {
      message = '浏览器暂时不允许访问本地存储，未能' + action + '。请检查隐私设置，或使用普通浏览窗口重试。';
    } else {
      message = '本地数据' + action + '失败，请重试。现有数据不会被自动清空。';
    }
    var result = new Error(message);
    result.name = name || 'StorageError';
    result.cause = error || null;
    return result;
  }

  function unavailable() {
    var error = new Error('此浏览器未提供可用的本地存储，修改尚未保存。请使用允许本地存储的普通浏览窗口。');
    error.name = 'StorageUnavailableError';
    return error;
  }

  function decode(value) {
    if (value === undefined || value === null) return null;
    if (typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('本地数据格式无法识别，现有数据已保留。');
    }
    if (value.__visenseStore === FORMAT) {
      if (!Number.isFinite(value.savedAt) || value.savedAt < 0 ||
          (value.deleted !== true && (!value.data || typeof value.data !== 'object' || Array.isArray(value.data)))) {
        throw new Error('本地数据不完整，现有数据已保留。');
      }
      return value;
    }
    // Older versions may have stored the workspace object directly.
    return { __visenseStore: FORMAT, savedAt: 0, data: value, legacy: true };
  }

  function timestamp() {
    lastStamp = Math.max(Date.now(), lastStamp + 1);
    return lastStamp;
  }

  function observe(record) {
    if (record) lastStamp = Math.max(lastStamp, record.savedAt || 0);
    return record;
  }

  function openDatabase() {
    return new Promise(function (resolve) {
      var request;
      var finished = false;
      var timer;
      function finish(database) {
        if (finished) {
          if (database) database.close();
          return;
        }
        finished = true;
        window.clearTimeout(timer);
        resolve(database);
      }
      try {
        if (!window.indexedDB) return finish(null);
        request = window.indexedDB.open(DATABASE, 1);
        timer = window.setTimeout(function () { finish(null); }, 2500);
        request.onupgradeneeded = function () {
          if (!request.result.objectStoreNames.contains(STORE)) {
            request.result.createObjectStore(STORE);
          }
        };
        request.onsuccess = function () { finish(request.result); };
        request.onerror = function () { finish(null); };
        // A blocked upgrade is bounded by the timeout; existing tabs keep their data.
        request.onblocked = function () {};
      } catch (error) {
        finish(null);
      }
    });
  }

  function initialize() {
    if (ready) return ready;
    ready = (async function () {
      try {
        local = window.localStorage;
        local.getItem(KEY);
      } catch (error) {
        local = null;
      }
      db = await openDatabase();
      if (db) {
        db.onversionchange = function () {
          db.close();
          db = null;
          mode = local ? 'localstorage' : 'memory';
        };
      }
      mode = db ? 'indexeddb' : local ? 'localstorage' : 'memory';
    })();
    return ready;
  }

  function idbOperation(write, value) {
    return new Promise(function (resolve, reject) {
      var transaction;
      var request;
      var result;
      var requestError;
      try {
        transaction = db.transaction(STORE, write ? 'readwrite' : 'readonly');
        var objectStore = transaction.objectStore(STORE);
        request = write ? objectStore.put(value, KEY) : objectStore.get(KEY);
        request.onsuccess = function () { result = request.result; };
        request.onerror = function () { requestError = request.error; };
        // Request success is not commit success: quota/abort can still happen here.
        transaction.oncomplete = function () {
          if (requestError) reject(requestError);
          else resolve(result);
        };
        transaction.onerror = function () { reject(transaction.error || requestError || new Error('Transaction failed')); };
        transaction.onabort = function () { reject(transaction.error || requestError || new Error('Transaction aborted')); };
      } catch (error) {
        reject(error);
      }
    });
  }

  function readLocal() {
    if (!local) return { record: null, raw: null };
    var raw = local.getItem(KEY);
    return { record: observe(raw === null ? null : decode(JSON.parse(raw))), raw: raw };
  }

  function removeMigratedLocal(raw) {
    if (!local || raw === null) return;
    try {
      // Do not remove a newer fallback write made by another open tab.
      if (local.getItem(KEY) === raw) local.removeItem(KEY);
    } catch (error) {
      // The committed IndexedDB copy is authoritative; a redundant copy is safe.
    }
  }

  async function readWorkspace() {
    await initialize();
    var idbRecord = null;
    var idbError = null;
    var localRead = { record: null, raw: null };
    var localError = null;
    var idbReadable = false;
    if (db) {
      try {
        idbRecord = observe(decode(await idbOperation(false)));
        idbReadable = true;
      } catch (error) { idbError = error; }
    }
    try { localRead = readLocal(); } catch (error) { localError = error; }
    var localRecord = localRead.record;
    var useLocal = localRecord && (!idbRecord || localRecord.legacy || localRecord.savedAt > idbRecord.savedAt);
    var chosen = useLocal ? localRecord : idbRecord;

    if (!chosen && (idbError || localError)) {
      throw storageError(idbError || localError, '读取');
    }
    if (useLocal && db && idbReadable) {
      var migrated = localRecord.legacy
        ? { __visenseStore: FORMAT, savedAt: timestamp(), data: copy(localRecord.data) }
        : localRecord;
      try {
        await idbOperation(true, migrated);
        chosen = migrated;
        mode = 'indexeddb';
        removeMigratedLocal(localRead.raw);
      } catch (error) {
        // Keep using the complete fallback copy if migration cannot commit.
        mode = 'localstorage';
      }
    } else if (chosen) {
      mode = useLocal ? 'localstorage' : 'indexeddb';
    } else {
      mode = idbReadable ? 'indexeddb' : local ? 'localstorage' : 'memory';
    }
    if (chosen) cached = chosen.deleted ? null : copy(chosen.data);
    else if (mode !== 'memory') cached = null;
    return copy(cached);
  }

  async function persist(record) {
    var idbError = null;
    if (db) {
      try {
        await idbOperation(true, record);
        mode = 'indexeddb';
        if (local) {
          try {
            var previous = readLocal();
            if (previous.record && previous.record.savedAt <= record.savedAt) removeMigratedLocal(previous.raw);
          } catch (error) { /* Preserve unrecognized fallback data. */ }
        }
        return;
      } catch (error) { idbError = error; }
    }
    if (local) {
      try {
        local.setItem(KEY, JSON.stringify(record));
        mode = 'localstorage';
        return;
      } catch (error) {
        var quota = error.name === 'QuotaExceededError' || error.name === 'NS_ERROR_DOM_QUOTA_REACHED';
        throw storageError(quota ? error : idbError || error, '保存');
      }
    }
    if (idbError) throw storageError(idbError, '保存');
    mode = 'memory';
    throw unavailable();
  }

  window.VisenseStore = Object.freeze({
    load: function () {
      return enqueue(readWorkspace);
    },
    save: function (data) {
      var snapshot;
      try {
        if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('请保存完整的数据对象。');
        snapshot = copy(data);
      } catch (error) {
        return Promise.reject(storageError(error, '保存'));
      }
      return enqueue(async function () {
        // Read existing revisions first, including a fallback saved by an earlier session.
        await readWorkspace();
        await persist({ __visenseStore: FORMAT, savedAt: timestamp(), data: snapshot });
        cached = copy(snapshot);
      });
    },
    clear: function () {
      return enqueue(async function () {
        await initialize();
        try { await readWorkspace(); } catch (error) { /* Explicit deletion may repair corrupt data. */ }
        // A deletion marker prevents an inaccessible older backend from resurrecting data.
        await persist({ __visenseStore: FORMAT, savedAt: timestamp(), deleted: true });
        cached = null;
      });
    },
    status: function () {
      return { mode: mode, persistent: mode !== 'memory' };
    }
  });
})(window);
