/**
 * vNetCard Studio - IndexedDB CRUD Wrapper
 *
 * Zero-dependency IndexedDB persistence layer for the vNetCard Studio PWA.
 * Manages the "cards" object store with full CRUD, soft-delete, search,
 * duplication, and statistics. Exposes a global `window.DB` object.
 *
 * Database: vnetcard_studio_db (v1)
 * Object Store: cards (autoIncrement key: id)
 * Indexes: businessName, status, createdAt, updatedAt
 */

(function () {
  "use strict";

  const DB_NAME = "vnetcard_studio_db";
  const DB_VERSION = 1;
  const STORE_NAME = "cards";

  let _db = null;

  /**
   * Wraps an IDBRequest in a Promise.
   */
  function promisifyRequest(request) {
    return new Promise(function (resolve, reject) {
      request.onsuccess = function () {
        resolve(request.result);
      };
      request.onerror = function () {
        reject(request.error);
      };
    });
  }

  /**
   * Wraps an IDBTransaction completion in a Promise.
   */
  function promisifyTransaction(transaction) {
    return new Promise(function (resolve, reject) {
      transaction.oncomplete = function () {
        resolve();
      };
      transaction.onerror = function () {
        reject(transaction.error);
      };
      transaction.onabort = function () {
        reject(transaction.error || new Error("Transaction aborted"));
      };
    });
  }

  /**
   * Returns a transaction and the cards object store.
   */
  function getStore(mode) {
    var tx = _db.transaction(STORE_NAME, mode);
    var store = tx.objectStore(STORE_NAME);
    return { tx: tx, store: store };
  }

  /**
   * Opens or creates the database. Creates the object store and indexes
   * on first run or version upgrade.
   */
  async function init() {
    if (_db) {
      return _db;
    }

    return new Promise(function (resolve, reject) {
      var request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = function (event) {
        var db = event.target.result;

        if (!db.objectStoreNames.contains(STORE_NAME)) {
          var store = db.createObjectStore(STORE_NAME, {
            keyPath: "id",
            autoIncrement: true,
          });
          store.createIndex("businessName", "businessName", { unique: false });
          store.createIndex("status", "status", { unique: false });
          store.createIndex("createdAt", "createdAt", { unique: false });
          store.createIndex("updatedAt", "updatedAt", { unique: false });
        }
      };

      request.onsuccess = function (event) {
        _db = event.target.result;

        _db.onversionchange = function () {
          _db.close();
          _db = null;
          console.warn("[DB] Database version changed. Connection closed.");
        };

        console.log("[DB] Database initialized successfully.");
        resolve(_db);
      };

      request.onerror = function () {
        console.error("[DB] Failed to open database:", request.error);
        reject(request.error);
      };

      request.onblocked = function () {
        console.warn("[DB] Database open blocked. Close other tabs using this database.");
      };
    });
  }

  /**
   * Upsert a card record.
   * - If cardData.id exists: updates the record, refreshes updatedAt.
   * - If no id: inserts a new record, sets createdAt and updatedAt.
   * Returns the saved card with its id.
   */
  async function saveCard(cardData) {
    try {
      await init();

      var now = new Date().toISOString();
      var card = Object.assign({}, cardData);

      if (card.id) {
        // Update existing card
        var ref = getStore("readwrite");
        var existing = await promisifyRequest(ref.store.get(card.id));

        if (!existing) {
          throw new Error("Card with id " + card.id + " not found");
        }

        card = Object.assign({}, existing, card);
        card.updatedAt = now;

        await promisifyRequest(ref.store.put(card));
        await promisifyTransaction(ref.tx);
      } else {
        // Insert new card
        card.createdAt = now;
        card.updatedAt = now;

        if (!card.status) {
          card.status = "draft";
        }

        var ref2 = getStore("readwrite");
        var newId = await promisifyRequest(ref2.store.add(card));
        card.id = newId;
        await promisifyTransaction(ref2.tx);
      }

      console.log("[DB] Card saved:", card.id);
      return card;
    } catch (err) {
      console.error("[DB] saveCard error:", err);
      throw err;
    }
  }

  /**
   * Get a single card by id. Returns the card object or null.
   */
  async function getCard(id) {
    try {
      await init();

      var ref = getStore("readonly");
      var card = await promisifyRequest(ref.store.get(id));

      return card || null;
    } catch (err) {
      console.error("[DB] getCard error:", err);
      return null;
    }
  }

  /**
   * Get all cards excluding soft-deleted ones, sorted by updatedAt descending.
   */
  async function getAllCards() {
    try {
      await init();

      var ref = getStore("readonly");
      var allCards = await promisifyRequest(ref.store.getAll());

      var filtered = allCards.filter(function (card) {
        return card.status !== "deleted";
      });

      filtered.sort(function (a, b) {
        return b.updatedAt > a.updatedAt ? 1 : b.updatedAt < a.updatedAt ? -1 : 0;
      });

      return filtered;
    } catch (err) {
      console.error("[DB] getAllCards error:", err);
      return [];
    }
  }

  /**
   * Soft-delete a card by setting status to "deleted" and updating updatedAt.
   * Returns true on success, false on failure.
   */
  async function deleteCard(id) {
    try {
      await init();

      var ref = getStore("readwrite");
      var card = await promisifyRequest(ref.store.get(id));

      if (!card) {
        console.warn("[DB] deleteCard: Card not found:", id);
        return false;
      }

      card.status = "deleted";
      card.updatedAt = new Date().toISOString();

      await promisifyRequest(ref.store.put(card));
      await promisifyTransaction(ref.tx);

      console.log("[DB] Card soft-deleted:", id);
      return true;
    } catch (err) {
      console.error("[DB] deleteCard error:", err);
      return false;
    }
  }

  /**
   * Search cards by businessName (case-insensitive substring match).
   * Excludes deleted cards. Returns results sorted by updatedAt descending.
   */
  async function searchCards(query) {
    try {
      await init();

      if (!query || typeof query !== "string") {
        return getAllCards();
      }

      var ref = getStore("readonly");
      var allCards = await promisifyRequest(ref.store.getAll());
      var lowerQuery = query.toLowerCase();

      var results = allCards.filter(function (card) {
        if (card.status === "deleted") return false;
        var name = (card.businessName || "").toLowerCase();
        return name.indexOf(lowerQuery) !== -1;
      });

      results.sort(function (a, b) {
        return b.updatedAt > a.updatedAt ? 1 : b.updatedAt < a.updatedAt ? -1 : 0;
      });

      return results;
    } catch (err) {
      console.error("[DB] searchCards error:", err);
      return [];
    }
  }

  /**
   * Get statistics: total, drafts, and completed counts (excluding deleted).
   */
  async function getStats() {
    try {
      await init();

      var ref = getStore("readonly");
      var allCards = await promisifyRequest(ref.store.getAll());

      var stats = { total: 0, drafts: 0, completed: 0 };

      for (var i = 0; i < allCards.length; i++) {
        var card = allCards[i];
        if (card.status === "deleted") continue;

        stats.total++;
        if (card.status === "draft") {
          stats.drafts++;
        } else if (card.status === "completed") {
          stats.completed++;
        }
      }

      return stats;
    } catch (err) {
      console.error("[DB] getStats error:", err);
      return { total: 0, drafts: 0, completed: 0 };
    }
  }

  /**
   * Duplicate a card: copies all fields, removes the id, prefixes
   * businessName with "Copy of", sets status to "draft", and assigns
   * fresh timestamps. Saves and returns the new card.
   */
  async function duplicateCard(id) {
    try {
      await init();

      var ref = getStore("readonly");
      var original = await promisifyRequest(ref.store.get(id));

      if (!original) {
        throw new Error("Card with id " + id + " not found");
      }

      var copy = Object.assign({}, original);
      delete copy.id;

      copy.businessName = "Copy of " + (original.businessName || "Untitled");
      copy.status = "draft";

      var now = new Date().toISOString();
      copy.createdAt = now;
      copy.updatedAt = now;

      var ref2 = getStore("readwrite");
      var newId = await promisifyRequest(ref2.store.add(copy));
      copy.id = newId;
      await promisifyTransaction(ref2.tx);

      console.log("[DB] Card duplicated:", id, "->", copy.id);
      return copy;
    } catch (err) {
      console.error("[DB] duplicateCard error:", err);
      throw err;
    }
  }

  // Expose the global DB object
  window.DB = {
    init: init,
    saveCard: saveCard,
    getCard: getCard,
    getAllCards: getAllCards,
    deleteCard: deleteCard,
    searchCards: searchCards,
    getStats: getStats,
    duplicateCard: duplicateCard,
  };
})();
