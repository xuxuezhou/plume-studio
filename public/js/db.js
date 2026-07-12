/* IndexedDB persistence layer. Global: PlumeDB
 *
 * Stores:
 *  - articles: full article documents (blocks included)
 *  - images:   image library entries ({ id, name, blob, ... })
 *  - versions: article version snapshots, indexed by articleId
 *  - meta:     singleton documents (settings, categories, tags, collections,
 *              templates, views, dailyStats)
 */
const PlumeDB = (() => {
  const DB_NAME = 'plume-studio';
  const DB_VERSION = 1;
  let dbPromise = null;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('articles')) db.createObjectStore('articles', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('images')) db.createObjectStore('images', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('versions')) {
          const store = db.createObjectStore('versions', { keyPath: 'id' });
          store.createIndex('articleId', 'articleId', { unique: false });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('无法打开本地数据库'));
    });
    return dbPromise;
  }

  function request(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function store(name, mode = 'readonly') {
    const db = await open();
    return db.transaction(name, mode).objectStore(name);
  }

  return {
    async get(name, id) {
      return request((await store(name)).get(id));
    },
    async all(name) {
      return request((await store(name)).getAll());
    },
    async put(name, value) {
      return request((await store(name, 'readwrite')).put(value));
    },
    async del(name, id) {
      return request((await store(name, 'readwrite')).delete(id));
    },
    async byIndex(name, index, value) {
      return request((await store(name)).index(index).getAll(value));
    },
    async clear(name) {
      return request((await store(name, 'readwrite')).clear());
    }
  };
})();
