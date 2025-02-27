/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { SnapshotVersion } from '../core/snapshot_version';
import {
  DocumentKeySet,
  DocumentSizeEntries,
  MutableDocumentMap,
  mutableDocumentMap
} from '../model/collections';
import { MutableDocument } from '../model/document';
import { DocumentKey } from '../model/document_key';
import { ResourcePath } from '../model/path';
import { debugAssert, debugCast, hardAssert } from '../util/assert';
import { primitiveComparator } from '../util/misc';
import { ObjectMap } from '../util/obj_map';
import { SortedMap } from '../util/sorted_map';
import { SortedSet } from '../util/sorted_set';

import { IndexManager } from './index_manager';
import { dbDocumentSize } from './indexeddb_mutation_batch_impl';
import { DbRemoteDocument, DbRemoteDocumentGlobal } from './indexeddb_schema';
import {
  DbRemoteDocumentCollectionReadTimeIndex,
  DbRemoteDocumentGlobalKey,
  DbRemoteDocumentGlobalStore,
  DbRemoteDocumentKey,
  DbRemoteDocumentReadTimeIndex,
  DbRemoteDocumentStore
} from './indexeddb_sentinels';
import { getStore } from './indexeddb_transaction';
import {
  fromDbRemoteDocument,
  fromDbTimestampKey,
  LocalSerializer,
  toDbRemoteDocument,
  toDbTimestampKey
} from './local_serializer';
import { PersistencePromise } from './persistence_promise';
import { PersistenceTransaction } from './persistence_transaction';
import { RemoteDocumentCache } from './remote_document_cache';
import { RemoteDocumentChangeBuffer } from './remote_document_change_buffer';
import { IterateOptions, SimpleDbStore } from './simple_db';

export interface DocumentSizeEntry {
  document: MutableDocument;
  size: number;
}

export interface IndexedDbRemoteDocumentCache extends RemoteDocumentCache {
  // The IndexedDbRemoteDocumentCache doesn't implement any methods on top
  // of RemoteDocumentCache. This class exists for consistency.
}

/**
 * The RemoteDocumentCache for IndexedDb. To construct, invoke
 * `newIndexedDbRemoteDocumentCache()`.
 */
class IndexedDbRemoteDocumentCacheImpl implements IndexedDbRemoteDocumentCache {
  indexManager!: IndexManager;

  constructor(readonly serializer: LocalSerializer) {}

  setIndexManager(indexManager: IndexManager): void {
    this.indexManager = indexManager;
  }

  /**
   * Adds the supplied entries to the cache.
   *
   * All calls of `addEntry` are required to go through the RemoteDocumentChangeBuffer
   * returned by `newChangeBuffer()` to ensure proper accounting of metadata.
   */
  addEntry(
    transaction: PersistenceTransaction,
    key: DocumentKey,
    doc: DbRemoteDocument
  ): PersistencePromise<void> {
    const documentStore = remoteDocumentsStore(transaction);
    return documentStore.put(dbKey(key), doc);
  }

  /**
   * Removes a document from the cache.
   *
   * All calls of `removeEntry`  are required to go through the RemoteDocumentChangeBuffer
   * returned by `newChangeBuffer()` to ensure proper accounting of metadata.
   */
  removeEntry(
    transaction: PersistenceTransaction,
    documentKey: DocumentKey
  ): PersistencePromise<void> {
    const store = remoteDocumentsStore(transaction);
    const key = dbKey(documentKey);
    return store.delete(key);
  }

  /**
   * Updates the current cache size.
   *
   * Callers to `addEntry()` and `removeEntry()` *must* call this afterwards to update the
   * cache's metadata.
   */
  updateMetadata(
    transaction: PersistenceTransaction,
    sizeDelta: number
  ): PersistencePromise<void> {
    return this.getMetadata(transaction).next(metadata => {
      metadata.byteSize += sizeDelta;
      return this.setMetadata(transaction, metadata);
    });
  }

  getEntry(
    transaction: PersistenceTransaction,
    documentKey: DocumentKey
  ): PersistencePromise<MutableDocument> {
    return remoteDocumentsStore(transaction)
      .get(dbKey(documentKey))
      .next(dbRemoteDoc => {
        return this.maybeDecodeDocument(documentKey, dbRemoteDoc);
      });
  }

  /**
   * Looks up an entry in the cache.
   *
   * @param documentKey - The key of the entry to look up.
   * @returns The cached document entry and its size.
   */
  getSizedEntry(
    transaction: PersistenceTransaction,
    documentKey: DocumentKey
  ): PersistencePromise<DocumentSizeEntry> {
    return remoteDocumentsStore(transaction)
      .get(dbKey(documentKey))
      .next(dbRemoteDoc => {
        const doc = this.maybeDecodeDocument(documentKey, dbRemoteDoc);
        return {
          document: doc,
          size: dbDocumentSize(dbRemoteDoc)
        };
      });
  }

  getEntries(
    transaction: PersistenceTransaction,
    documentKeys: DocumentKeySet
  ): PersistencePromise<MutableDocumentMap> {
    let results = mutableDocumentMap();
    return this.forEachDbEntry(
      transaction,
      documentKeys,
      (key, dbRemoteDoc) => {
        const doc = this.maybeDecodeDocument(key, dbRemoteDoc);
        results = results.insert(key, doc);
      }
    ).next(() => results);
  }

  /**
   * Looks up several entries in the cache.
   *
   * @param documentKeys - The set of keys entries to look up.
   * @returns A map of documents indexed by key and a map of sizes indexed by
   *     key (zero if the document does not exist).
   */
  getSizedEntries(
    transaction: PersistenceTransaction,
    documentKeys: DocumentKeySet
  ): PersistencePromise<DocumentSizeEntries> {
    let results = mutableDocumentMap();
    let sizeMap = new SortedMap<DocumentKey, number>(DocumentKey.comparator);
    return this.forEachDbEntry(
      transaction,
      documentKeys,
      (key, dbRemoteDoc) => {
        const doc = this.maybeDecodeDocument(key, dbRemoteDoc);
        results = results.insert(key, doc);
        sizeMap = sizeMap.insert(key, dbDocumentSize(dbRemoteDoc));
      }
    ).next(() => {
      return { documents: results, sizeMap };
    });
  }

  private forEachDbEntry(
    transaction: PersistenceTransaction,
    documentKeys: DocumentKeySet,
    callback: (key: DocumentKey, doc: DbRemoteDocument | null) => void
  ): PersistencePromise<void> {
    if (documentKeys.isEmpty()) {
      return PersistencePromise.resolve();
    }

    const range = IDBKeyRange.bound(
      documentKeys.first()!.path.toArray(),
      documentKeys.last()!.path.toArray()
    );
    const keyIter = documentKeys.getIterator();
    let nextKey: DocumentKey | null = keyIter.getNext();

    return remoteDocumentsStore(transaction)
      .iterate({ range }, (potentialKeyRaw, dbRemoteDoc, control) => {
        const potentialKey = DocumentKey.fromSegments(potentialKeyRaw);

        // Go through keys not found in cache.
        while (nextKey && DocumentKey.comparator(nextKey!, potentialKey) < 0) {
          callback(nextKey!, null);
          nextKey = keyIter.getNext();
        }

        if (nextKey && nextKey!.isEqual(potentialKey)) {
          // Key found in cache.
          callback(nextKey!, dbRemoteDoc);
          nextKey = keyIter.hasNext() ? keyIter.getNext() : null;
        }

        // Skip to the next key (if there is one).
        if (nextKey) {
          control.skip(nextKey!.path.toArray());
        } else {
          control.done();
        }
      })
      .next(() => {
        // The rest of the keys are not in the cache. One case where `iterate`
        // above won't go through them is when the cache is empty.
        while (nextKey) {
          callback(nextKey!, null);
          nextKey = keyIter.hasNext() ? keyIter.getNext() : null;
        }
      });
  }

  getAll(
    transaction: PersistenceTransaction,
    collection: ResourcePath,
    sinceReadTime: SnapshotVersion
  ): PersistencePromise<MutableDocumentMap> {
    let results = mutableDocumentMap();

    const immediateChildrenPathLength = collection.length + 1;

    const iterationOptions: IterateOptions = {};
    if (sinceReadTime.isEqual(SnapshotVersion.min())) {
      // Documents are ordered by key, so we can use a prefix scan to narrow
      // down the documents we need to match the query against.
      const startKey = collection.toArray();
      iterationOptions.range = IDBKeyRange.lowerBound(startKey);
    } else {
      // Execute an index-free query and filter by read time. This is safe
      // since all document changes to queries that have a
      // lastLimboFreeSnapshotVersion (`sinceReadTime`) have a read time set.
      const collectionKey = collection.toArray();
      const readTimeKey = toDbTimestampKey(sinceReadTime);
      iterationOptions.range = IDBKeyRange.lowerBound(
        [collectionKey, readTimeKey],
        /* open= */ true
      );
      iterationOptions.index = DbRemoteDocumentCollectionReadTimeIndex;
    }

    return remoteDocumentsStore(transaction)
      .iterate(iterationOptions, (key, dbRemoteDoc, control) => {
        // The query is actually returning any path that starts with the query
        // path prefix which may include documents in subcollections. For
        // example, a query on 'rooms' will return rooms/abc/messages/xyx but we
        // shouldn't match it. Fix this by discarding rows with document keys
        // more than one segment longer than the query path.
        if (key.length !== immediateChildrenPathLength) {
          return;
        }

        const document = this.maybeDecodeDocument(
          DocumentKey.fromSegments(key),
          dbRemoteDoc
        );
        if (collection.isPrefixOf(document.key.path)) {
          results = results.insert(document.key, document);
        } else {
          control.done();
        }
      })
      .next(() => results);
  }

  newChangeBuffer(options?: {
    trackRemovals: boolean;
  }): RemoteDocumentChangeBuffer {
    return new IndexedDbRemoteDocumentChangeBuffer(
      this,
      !!options && options.trackRemovals
    );
  }

  getSize(txn: PersistenceTransaction): PersistencePromise<number> {
    return this.getMetadata(txn).next(metadata => metadata.byteSize);
  }

  private getMetadata(
    txn: PersistenceTransaction
  ): PersistencePromise<DbRemoteDocumentGlobal> {
    return documentGlobalStore(txn)
      .get(DbRemoteDocumentGlobalKey)
      .next(metadata => {
        hardAssert(!!metadata, 'Missing document cache metadata');
        return metadata!;
      });
  }

  private setMetadata(
    txn: PersistenceTransaction,
    metadata: DbRemoteDocumentGlobal
  ): PersistencePromise<void> {
    return documentGlobalStore(txn).put(DbRemoteDocumentGlobalKey, metadata);
  }

  /**
   * Decodes `dbRemoteDoc` and returns the document (or an invalid document if
   * the document corresponds to the format used for sentinel deletes).
   */
  private maybeDecodeDocument(
    documentKey: DocumentKey,
    dbRemoteDoc: DbRemoteDocument | null
  ): MutableDocument {
    if (dbRemoteDoc) {
      const doc = fromDbRemoteDocument(this.serializer, dbRemoteDoc);
      // Whether the document is a sentinel removal and should only be used in the
      // `getNewDocumentChanges()`
      const isSentinelRemoval =
        doc.isNoDocument() && doc.version.isEqual(SnapshotVersion.min());
      if (!isSentinelRemoval) {
        return doc;
      }
    }
    return MutableDocument.newInvalidDocument(documentKey);
  }
}

/** Creates a new IndexedDbRemoteDocumentCache. */
export function newIndexedDbRemoteDocumentCache(
  serializer: LocalSerializer
): IndexedDbRemoteDocumentCache {
  return new IndexedDbRemoteDocumentCacheImpl(serializer);
}

/**
 * Returns the set of documents that have changed since the specified read
 * time.
 */
// PORTING NOTE: This is only used for multi-tab synchronization.
export function remoteDocumentCacheGetNewDocumentChanges(
  remoteDocumentCache: IndexedDbRemoteDocumentCache,
  transaction: PersistenceTransaction,
  sinceReadTime: SnapshotVersion
): PersistencePromise<{
  changedDocs: MutableDocumentMap;
  readTime: SnapshotVersion;
}> {
  const remoteDocumentCacheImpl = debugCast(
    remoteDocumentCache,
    IndexedDbRemoteDocumentCacheImpl // We only support IndexedDb in multi-tab mode.
  );
  let changedDocs = mutableDocumentMap();

  let lastReadTime = toDbTimestampKey(sinceReadTime);

  const documentsStore = remoteDocumentsStore(transaction);
  const range = IDBKeyRange.lowerBound(lastReadTime, true);
  return documentsStore
    .iterate(
      { index: DbRemoteDocumentReadTimeIndex, range },
      (_, dbRemoteDoc) => {
        // Unlike `getEntry()` and others, `getNewDocumentChanges()` parses
        // the documents directly since we want to keep sentinel deletes.
        const doc = fromDbRemoteDocument(
          remoteDocumentCacheImpl.serializer,
          dbRemoteDoc
        );
        changedDocs = changedDocs.insert(doc.key, doc);
        lastReadTime = dbRemoteDoc.readTime!;
      }
    )
    .next(() => {
      return {
        changedDocs,
        readTime: fromDbTimestampKey(lastReadTime)
      };
    });
}

/**
 * Returns the read time of the most recently read document in the cache, or
 * SnapshotVersion.min() if not available.
 */
// PORTING NOTE: This is only used for multi-tab synchronization.
export function remoteDocumentCacheGetLastReadTime(
  transaction: PersistenceTransaction
): PersistencePromise<SnapshotVersion> {
  const documentsStore = remoteDocumentsStore(transaction);

  // If there are no existing entries, we return SnapshotVersion.min().
  let readTime = SnapshotVersion.min();

  return documentsStore
    .iterate(
      { index: DbRemoteDocumentReadTimeIndex, reverse: true },
      (key, dbRemoteDoc, control) => {
        if (dbRemoteDoc.readTime) {
          readTime = fromDbTimestampKey(dbRemoteDoc.readTime);
        }
        control.done();
      }
    )
    .next(() => readTime);
}

/**
 * Handles the details of adding and updating documents in the IndexedDbRemoteDocumentCache.
 *
 * Unlike the MemoryRemoteDocumentChangeBuffer, the IndexedDb implementation computes the size
 * delta for all submitted changes. This avoids having to re-read all documents from IndexedDb
 * when we apply the changes.
 */
class IndexedDbRemoteDocumentChangeBuffer extends RemoteDocumentChangeBuffer {
  // A map of document sizes prior to applying the changes in this buffer.
  protected documentSizes: ObjectMap<DocumentKey, number> = new ObjectMap(
    key => key.toString(),
    (l, r) => l.isEqual(r)
  );

  /**
   * @param documentCache - The IndexedDbRemoteDocumentCache to apply the changes to.
   * @param trackRemovals - Whether to create sentinel deletes that can be tracked by
   * `getNewDocumentChanges()`.
   */
  constructor(
    private readonly documentCache: IndexedDbRemoteDocumentCacheImpl,
    private readonly trackRemovals: boolean
  ) {
    super();
  }

  protected applyChanges(
    transaction: PersistenceTransaction
  ): PersistencePromise<void> {
    const promises: Array<PersistencePromise<void>> = [];

    let sizeDelta = 0;

    let collectionParents = new SortedSet<ResourcePath>((l, r) =>
      primitiveComparator(l.canonicalString(), r.canonicalString())
    );

    this.changes.forEach((key, documentChange) => {
      const previousSize = this.documentSizes.get(key);
      debugAssert(
        previousSize !== undefined,
        `Cannot modify a document that wasn't read (for ${key})`
      );
      if (documentChange.isValidDocument()) {
        debugAssert(
          !documentChange.readTime.isEqual(SnapshotVersion.min()),
          'Cannot add a document with a read time of zero'
        );
        const doc = toDbRemoteDocument(
          this.documentCache.serializer,
          documentChange
        );
        collectionParents = collectionParents.add(key.path.popLast());

        const size = dbDocumentSize(doc);
        sizeDelta += size - previousSize!;
        promises.push(this.documentCache.addEntry(transaction, key, doc));
      } else {
        sizeDelta -= previousSize!;
        if (this.trackRemovals) {
          // In order to track removals, we store a "sentinel delete" in the
          // RemoteDocumentCache. This entry is represented by a NoDocument
          // with a version of 0 and ignored by `maybeDecodeDocument()` but
          // preserved in `getNewDocumentChanges()`.
          const deletedDoc = toDbRemoteDocument(
            this.documentCache.serializer,
            documentChange.convertToNoDocument(SnapshotVersion.min())
          );
          promises.push(
            this.documentCache.addEntry(transaction, key, deletedDoc)
          );
        } else {
          promises.push(this.documentCache.removeEntry(transaction, key));
        }
      }
    });

    collectionParents.forEach(parent => {
      promises.push(
        this.documentCache.indexManager.addToCollectionParentIndex(
          transaction,
          parent
        )
      );
    });

    promises.push(this.documentCache.updateMetadata(transaction, sizeDelta));

    return PersistencePromise.waitFor(promises);
  }

  protected getFromCache(
    transaction: PersistenceTransaction,
    documentKey: DocumentKey
  ): PersistencePromise<MutableDocument> {
    // Record the size of everything we load from the cache so we can compute a delta later.
    return this.documentCache
      .getSizedEntry(transaction, documentKey)
      .next(getResult => {
        this.documentSizes.set(documentKey, getResult.size);
        return getResult.document;
      });
  }

  protected getAllFromCache(
    transaction: PersistenceTransaction,
    documentKeys: DocumentKeySet
  ): PersistencePromise<MutableDocumentMap> {
    // Record the size of everything we load from the cache so we can compute
    // a delta later.
    return this.documentCache
      .getSizedEntries(transaction, documentKeys)
      .next(({ documents, sizeMap }) => {
        // Note: `getAllFromCache` returns two maps instead of a single map from
        // keys to `DocumentSizeEntry`s. This is to allow returning the
        // `MutableDocumentMap` directly, without a conversion.
        sizeMap.forEach((documentKey, size) => {
          this.documentSizes.set(documentKey, size);
        });
        return documents;
      });
  }
}

function documentGlobalStore(
  txn: PersistenceTransaction
): SimpleDbStore<DbRemoteDocumentGlobalKey, DbRemoteDocumentGlobal> {
  return getStore<DbRemoteDocumentGlobalKey, DbRemoteDocumentGlobal>(
    txn,
    DbRemoteDocumentGlobalStore
  );
}

/**
 * Helper to get a typed SimpleDbStore for the remoteDocuments object store.
 */
function remoteDocumentsStore(
  txn: PersistenceTransaction
): SimpleDbStore<DbRemoteDocumentKey, DbRemoteDocument> {
  return getStore<DbRemoteDocumentKey, DbRemoteDocument>(
    txn,
    DbRemoteDocumentStore
  );
}

function dbKey(docKey: DocumentKey): DbRemoteDocumentKey {
  return docKey.path.toArray();
}
