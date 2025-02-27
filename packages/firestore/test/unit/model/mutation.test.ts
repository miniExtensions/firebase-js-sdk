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

import { expect } from 'chai';

import {
  arrayRemove,
  arrayUnion,
  increment,
  Timestamp,
  serverTimestamp,
  deleteField
} from '../../../src';
import { MutableDocument } from '../../../src/model/document';
import {
  mutationApplyToLocalView,
  mutationApplyToRemoteDocument,
  mutationExtractBaseValue,
  Mutation,
  MutationResult,
  Precondition
} from '../../../src/model/mutation';
import { serverTimestamp as serverTimestampInternal } from '../../../src/model/server_timestamps';
import {
  ArrayRemoveTransformOperation,
  ArrayUnionTransformOperation
} from '../../../src/model/transform_operation';
import { Dict } from '../../../src/util/obj';
import { addEqualityMatcher } from '../../util/equality_matcher';
import {
  deletedDoc,
  deleteMutation,
  doc,
  field,
  invalidDoc,
  key,
  mutationResult,
  patchMutation,
  setMutation,
  unknownDoc,
  version,
  wrap,
  wrapObject
} from '../../util/helpers';

describe('Mutation', () => {
  addEqualityMatcher();

  const timestamp = Timestamp.now();

  it('can apply sets to documents', () => {
    const docData = { foo: 'foo-value', baz: 'baz-value' };
    const document = doc('collection/key', 0, docData);

    const set = setMutation('collection/key', { bar: 'bar-value' });
    mutationApplyToLocalView(set, document, timestamp);
    expect(document).to.deep.equal(
      doc('collection/key', 0, { bar: 'bar-value' }).setHasLocalMutations()
    );
  });

  it('can apply patches to documents', () => {
    const docData = { foo: { bar: 'bar-value' }, baz: 'baz-value' };

    const document = doc('collection/key', 0, docData);
    const patch = patchMutation('collection/key', {
      'foo.bar': 'new-bar-value'
    });

    mutationApplyToLocalView(patch, document, timestamp);
    expect(document).to.deep.equal(
      doc('collection/key', 0, {
        foo: { bar: 'new-bar-value' },
        baz: 'baz-value'
      }).setHasLocalMutations()
    );
  });

  it('can apply patches with merges to missing documents', () => {
    const timestamp = Timestamp.now();

    const document = deletedDoc('collection/key', 0);
    const patch = patchMutation(
      'collection/key',
      { 'foo.bar': 'new-bar-value' },
      Precondition.none()
    );

    mutationApplyToLocalView(patch, document, timestamp);
    expect(document).to.deep.equal(
      doc('collection/key', 0, {
        foo: { bar: 'new-bar-value' }
      }).setHasLocalMutations()
    );
  });

  it('can apply patches with merges to null documents', () => {
    const timestamp = Timestamp.now();

    const document = MutableDocument.newInvalidDocument(key('collection/key'));
    const patch = patchMutation(
      'collection/key',
      { 'foo.bar': 'new-bar-value' },
      Precondition.none()
    );

    mutationApplyToLocalView(patch, document, timestamp);
    expect(document).to.deep.equal(
      doc('collection/key', 0, {
        foo: { bar: 'new-bar-value' }
      }).setHasLocalMutations()
    );
  });

  it('will delete values from the field-mask', () => {
    const document = doc('collection/key', 0, {
      foo: { bar: 'bar-value', baz: 'baz-value' }
    });
    const patch = patchMutation('collection/key', {
      'foo.bar': deleteField()
    });

    mutationApplyToLocalView(patch, document, timestamp);
    expect(document).to.deep.equal(
      doc('collection/key', 0, {
        foo: { baz: 'baz-value' }
      }).setHasLocalMutations()
    );
  });

  it('will patch a primitive value', () => {
    const document = doc('collection/key', 0, {
      foo: 'foo-value',
      baz: 'baz-value'
    });
    const patch = patchMutation('collection/key', {
      'foo.bar': 'new-bar-value'
    });

    mutationApplyToLocalView(patch, document, timestamp);
    expect(document).to.deep.equal(
      doc('collection/key', 0, {
        foo: { bar: 'new-bar-value' },
        baz: 'baz-value'
      }).setHasLocalMutations()
    );
  });

  it('patching a NoDocument yields a NoDocument', () => {
    const document = deletedDoc('collection/key', 0);
    const patch = patchMutation('collection/key', { foo: 'bar' });
    mutationApplyToLocalView(patch, document, timestamp);
    expect(document).to.deep.equal(deletedDoc('collection/key', 0));
  });

  it('can apply local serverTimestamp transforms to documents', () => {
    const docData = { foo: { bar: 'bar-value' }, baz: 'baz-value' };

    const document = doc('collection/key', 0, docData);
    const transform = patchMutation('collection/key', {
      'foo.bar': serverTimestamp()
    });

    mutationApplyToLocalView(transform, document, timestamp);

    // Server timestamps aren't parsed, so we manually insert it.
    const data = wrapObject({
      foo: { bar: '<server-timestamp>' },
      baz: 'baz-value'
    });
    data.set(field('foo.bar'), serverTimestampInternal(timestamp, null));
    const expectedDoc = doc('collection/key', 0, data).setHasLocalMutations();

    expect(document).to.deep.equal(expectedDoc);
  });

  // NOTE: This is more a test of UserDataReader code than Mutation code but
  // we don't have unit tests for it currently. We could consider removing this
  // test once we have integration tests.
  it('can create arrayUnion() transform.', () => {
    const transform = patchMutation('collection/key', {
      foo: arrayUnion('tag'),
      'bar.baz': arrayUnion(true, { nested: { a: [1, 2] } })
    });
    expect(transform.fieldTransforms).to.have.lengthOf(2);

    const first = transform.fieldTransforms[0];
    expect(first.field).to.deep.equal(field('foo'));
    expect(first.transform).to.deep.equal(
      new ArrayUnionTransformOperation([wrap('tag')])
    );

    const second = transform.fieldTransforms[1];
    expect(second.field).to.deep.equal(field('bar.baz'));
    expect(second.transform).to.deep.equal(
      new ArrayUnionTransformOperation([
        wrap(true),
        wrap({ nested: { a: [1, 2] } })
      ])
    );
  });

  // NOTE: This is more a test of UserDataReader code than Mutation code but
  // we don't have unit tests for it currently. We could consider removing this
  // test once we have integration tests.
  it('can create arrayRemove() transform.', () => {
    const transform = patchMutation('collection/key', {
      foo: arrayRemove('tag')
    });
    expect(transform.fieldTransforms).to.have.lengthOf(1);

    const first = transform.fieldTransforms[0];
    expect(first.field).to.deep.equal(field('foo'));
    expect(first.transform).to.deep.equal(
      new ArrayRemoveTransformOperation([wrap('tag')])
    );
  });

  it('can apply local arrayUnion transform to missing field', () => {
    const baseDoc = {};
    const transform = { missing: arrayUnion(1, 2) };
    const expected = { missing: [1, 2] };
    verifyTransform(baseDoc, transform, expected);
  });

  it('can apply local arrayUnion transform to non-array field', () => {
    const baseDoc = { 'non-array': 42 };
    const transform = { 'non-array': arrayUnion(1, 2) };
    const expected = { 'non-array': [1, 2] };
    verifyTransform(baseDoc, transform, expected);
  });

  it('can apply local arrayUnion transform with non-existing elements', () => {
    const baseDoc = { array: [1, 3] };
    const transform = { array: arrayUnion(2, 4) };
    const expected = { array: [1, 3, 2, 4] };
    verifyTransform(baseDoc, transform, expected);
  });

  it('can apply local arrayUnion transform with existing elements', () => {
    const baseDoc = { array: [1, 3] };
    const transform = { array: arrayUnion(1, 3) };
    const expected = { array: [1, 3] };
    verifyTransform(baseDoc, transform, expected);
  });

  it('can apply local arrayUnion transform with duplicate existing elements', () => {
    // Duplicate entries in your existing array should be preserved.
    const baseDoc = { array: [1, 2, 2, 3] };
    const transform = { array: arrayUnion(2) };
    const expected = { array: [1, 2, 2, 3] };
    verifyTransform(baseDoc, transform, expected);
  });

  it('can apply local arrayUnion transform with duplicate union elements', () => {
    // Duplicate entries in your union array should only be added once.
    const baseDoc = { array: [1, 3] };
    const transform = { array: arrayUnion(2, 2) };
    const expected = { array: [1, 3, 2] };
    verifyTransform(baseDoc, transform, expected);
  });

  it('can apply local arrayUnion transform with non-primitive elements', () => {
    // Union nested object values (one existing, one not).
    const baseDoc = { array: [1, { a: 'b' }] };
    const transform = { array: arrayUnion({ a: 'b' }, { c: 'd' }) };
    const expected = { array: [1, { a: 'b' }, { c: 'd' }] };
    verifyTransform(baseDoc, transform, expected);
  });

  it('can apply local arrayUnion transform with partially-overlapping elements', () => {
    // Union objects that partially overlap an existing object.
    const baseDoc = { array: [1, { a: 'b', c: 'd' }] };
    const transform = { array: arrayUnion({ a: 'b' }, { c: 'd' }) };
    const expected = { array: [1, { a: 'b', c: 'd' }, { a: 'b' }, { c: 'd' }] };
    verifyTransform(baseDoc, transform, expected);
  });

  it('can apply local arrayRemove transform to missing field', () => {
    const baseDoc = {};
    const transform = { missing: arrayRemove(1, 2) };
    const expected = { missing: [] };
    verifyTransform(baseDoc, transform, expected);
  });

  it('can apply local arrayRemove transform to non-array field', () => {
    const baseDoc = { 'non-array': 42 };
    const transform = { 'non-array': arrayRemove(1, 2) };
    const expected = { 'non-array': [] };
    verifyTransform(baseDoc, transform, expected);
  });

  it('can apply local arrayRemove transform with non-existing elements', () => {
    const baseDoc = { array: [1, 3] };
    const transform = { array: arrayRemove(2, 4) };
    const expected = { array: [1, 3] };
    verifyTransform(baseDoc, transform, expected);
  });

  it('can apply local arrayRemove transform with existing elements', () => {
    const baseDoc = { array: [1, 2, 3, 4] };
    const transform = { array: arrayRemove(1, 3) };
    const expected = { array: [2, 4] };
    verifyTransform(baseDoc, transform, expected);
  });

  it('can apply local arrayRemove transform with non-primitive elements', () => {
    // Remove nested object values (one existing, one not).
    const baseDoc = { array: [1, { a: 'b' }] };
    const transform = {
      array: arrayRemove({ a: 'b' }, { c: 'd' })
    };
    const expected = { array: [1] };
    verifyTransform(baseDoc, transform, expected);
  });

  function verifyTransform(
    baseData: Dict<unknown>,
    transformData: Dict<unknown> | Array<Dict<unknown>>,
    expectedData: Dict<unknown>
  ): void {
    const document = doc('collection/key', 0, baseData);
    const transforms = Array.isArray(transformData)
      ? transformData
      : [transformData];

    for (const transformData of transforms) {
      const transform = patchMutation('collection/key', transformData);
      mutationApplyToLocalView(transform, document, timestamp);
    }

    const expectedDoc = doc(
      'collection/key',
      0,
      expectedData
    ).setHasLocalMutations();
    expect(document).to.deep.equal(expectedDoc);
  }

  it('can apply server-acked serverTimestamp transform to documents', () => {
    const docData = { foo: { bar: 'bar-value' }, baz: 'baz-value' };

    const document = doc('collection/key', 0, docData);
    const transform = patchMutation('collection/key', {
      'foo.bar': serverTimestamp()
    });

    const mutationResult = new MutationResult(version(1), [
      {
        timestampValue: {
          seconds: timestamp.seconds,
          nanos: timestamp.nanoseconds
        }
      }
    ]);
    mutationApplyToRemoteDocument(transform, document, mutationResult);

    expect(document).to.deep.equal(
      doc('collection/key', 1, {
        foo: { bar: timestamp.toDate() },
        baz: 'baz-value'
      }).setHasCommittedMutations()
    );
  });

  it('can apply server-acked array transforms to document', () => {
    const docData = { array1: [1, 2], array2: ['a', 'b'] };
    const document = doc('collection/key', 0, docData);
    const transform = setMutation('collection/key', {
      array1: arrayUnion(2, 3),
      array2: arrayRemove('a', 'c')
    });

    // Server just sends null transform results for array operations.
    const mutationResult = new MutationResult(version(1), [null, null]);
    mutationApplyToRemoteDocument(transform, document, mutationResult);

    expect(document).to.deep.equal(
      doc('collection/key', 1, {
        array1: [1, 2, 3],
        array2: ['b']
      }).setHasCommittedMutations()
    );
  });

  it('can apply numeric add transform to document', () => {
    const baseDoc = {
      longPlusLong: 1,
      longPlusDouble: 2,
      doublePlusLong: 3.3,
      doublePlusDouble: 4.0,
      longPlusNan: 5,
      doublePlusNan: 6.6,
      longPlusInfinity: 7,
      doublePlusInfinity: 8.8
    };
    const transform = {
      longPlusLong: increment(1),
      longPlusDouble: increment(2.2),
      doublePlusLong: increment(3),
      doublePlusDouble: increment(4.4),
      longPlusNan: increment(Number.NaN),
      doublePlusNan: increment(Number.NaN),
      longPlusInfinity: increment(Number.POSITIVE_INFINITY),
      doublePlusInfinity: increment(Number.POSITIVE_INFINITY)
    };
    const expected = {
      longPlusLong: 2,
      longPlusDouble: 4.2,
      doublePlusLong: 6.3,
      doublePlusDouble: 8.4,
      longPlusNan: Number.NaN,
      doublePlusNan: Number.NaN,
      longPlusInfinity: Number.POSITIVE_INFINITY,
      doublePlusInfinity: Number.POSITIVE_INFINITY
    };
    verifyTransform(baseDoc, transform, expected);
  });

  it('can apply numeric add transform to unexpected type', () => {
    const baseDoc = { stringVal: 'zero' };
    const transform = { stringVal: increment(1) };
    const expected = { stringVal: 1 };
    verifyTransform(baseDoc, transform, expected);
  });

  it('can apply numeric add transform to missing field', () => {
    const baseDoc = {};
    const transform = { missing: increment(1) };
    const expected = { missing: 1 };
    verifyTransform(baseDoc, transform, expected);
  });

  it('can apply numeric add transforms consecutively', () => {
    const baseDoc = { numberVal: 1 };
    const transform1 = { numberVal: increment(2) };
    const transform2 = { numberVal: increment(3) };
    const transform3 = { numberVal: increment(4) };
    const expected = { numberVal: 10 };
    verifyTransform(baseDoc, [transform1, transform2, transform3], expected);
  });

  // PORTING NOTE: The `increment()` overflow/underflow tests from Android/iOS
  // are not applicable to Web since we expose JavaScript's number arithmetic
  // directly.

  it('can apply server-acked numeric add transform to document', () => {
    const docData = { sum: 1 };
    const document = doc('collection/key', 0, docData);
    const transform = setMutation('collection/key', {
      sum: increment(2)
    });

    const mutationResult = new MutationResult(version(1), [
      { integerValue: 3 }
    ]);
    mutationApplyToRemoteDocument(transform, document, mutationResult);

    expect(document).to.deep.equal(
      doc('collection/key', 1, { sum: 3 }).setHasCommittedMutations()
    );
  });

  it('can apply deletes to documents', () => {
    const document = doc('collection/key', 0, { foo: 'bar' });

    const mutation = deleteMutation('collection/key');
    mutationApplyToLocalView(mutation, document, Timestamp.now());
    expect(document).to.deep.equal(deletedDoc('collection/key', 0));
  });

  it('can apply sets with mutation results', () => {
    const document = doc('collection/key', 0, { foo: 'bar' });

    const docSet = setMutation('collection/key', { foo: 'new-bar' });
    const setResult = mutationResult(4);
    mutationApplyToRemoteDocument(docSet, document, setResult);
    expect(document).to.deep.equal(
      doc('collection/key', 4, { foo: 'new-bar' }).setHasCommittedMutations()
    );
  });

  it('will apply patches with mutation results', () => {
    const document = doc('collection/key', 0, { foo: 'bar' });

    const mutation = patchMutation('collection/key', { foo: 'new-bar' });
    const result = mutationResult(5);
    mutationApplyToRemoteDocument(mutation, document, result);
    expect(document).to.deep.equal(
      doc('collection/key', 5, { foo: 'new-bar' }).setHasCommittedMutations()
    );
  });

  function assertVersionTransitions(
    mutation: Mutation,
    base: MutableDocument,
    mutationResult: MutationResult,
    expected: MutableDocument
  ): void {
    const documentCopy = base.mutableCopy();
    mutationApplyToRemoteDocument(mutation, documentCopy, mutationResult);
    expect(documentCopy).to.deep.equal(expected);
  }

  it('transitions versions correctly', () => {
    const docV3 = doc('collection/key', 3, {});
    const deletedV3 = deletedDoc('collection/key', 3);
    const invalidV3 = invalidDoc('collection/key');

    const set = setMutation('collection/key', {});
    const patch = patchMutation('collection/key', {});
    const deleter = deleteMutation('collection/key');

    const mutationResult = new MutationResult(
      version(7),
      /*transformResults=*/ []
    );
    const docV7Unknown = unknownDoc('collection/key', 7);
    const docV7Deleted = deletedDoc(
      'collection/key',
      7
    ).setHasCommittedMutations();
    const docV7Committed = doc(
      'collection/key',
      7,
      {}
    ).setHasCommittedMutations();

    assertVersionTransitions(set, docV3, mutationResult, docV7Committed);
    assertVersionTransitions(set, deletedV3, mutationResult, docV7Committed);
    assertVersionTransitions(set, invalidV3, mutationResult, docV7Committed);

    assertVersionTransitions(patch, docV3, mutationResult, docV7Committed);
    assertVersionTransitions(patch, deletedV3, mutationResult, docV7Unknown);
    assertVersionTransitions(patch, invalidV3, mutationResult, docV7Unknown);

    assertVersionTransitions(deleter, docV3, mutationResult, docV7Deleted);
    assertVersionTransitions(deleter, deletedV3, mutationResult, docV7Deleted);
    assertVersionTransitions(deleter, invalidV3, mutationResult, docV7Deleted);
  });

  it('extracts null base value for non-transform mutation', () => {
    const data = { foo: 'foo' };
    const baseDoc = doc('collection/key', 0, data);

    const set = setMutation('collection/key', { foo: 'bar' });
    expect(mutationExtractBaseValue(set, baseDoc)).to.be.null;

    const patch = patchMutation('collection/key', { foo: 'bar' });
    expect(mutationExtractBaseValue(patch, baseDoc)).to.be.null;

    const deleter = deleteMutation('collection/key');
    expect(mutationExtractBaseValue(deleter, baseDoc)).to.be.null;
  });

  it('extracts null base value for ServerTimestamp', () => {
    const allValues = { time: 'foo', nested: { time: 'foo' } };
    const baseDoc = doc('collection/key', 0, allValues);

    const allTransforms = {
      time: serverTimestamp(),
      nested: { time: serverTimestamp() }
    };

    // Server timestamps are idempotent and don't have base values.
    const transform = patchMutation('collection/key', allTransforms);
    expect(mutationExtractBaseValue(transform, baseDoc)).to.be.null;
  });

  it('extracts base value for increment', () => {
    const allValues = {
      ignore: 'foo',
      double: 42.0,
      long: 42,
      text: 'foo',
      map: {},
      nested: { ignore: 'foo', double: 42.0, long: 42, text: 'foo', map: {} }
    };
    const baseDoc = doc('collection/key', 0, allValues);

    const allTransforms = {
      double: increment(1),
      long: increment(1),
      text: increment(1),
      map: increment(1),
      missing: increment(1),
      nested: {
        double: increment(1),
        long: increment(1),
        text: increment(1),
        map: increment(1),
        missing: increment(1)
      }
    };
    const transform = patchMutation('collection/key', allTransforms);

    const expectedBaseValue = wrapObject({
      double: 42.0,
      long: 42,
      text: 0,
      map: 0,
      missing: 0,
      nested: { double: 42.0, long: 42, text: 0, map: 0, missing: 0 }
    });
    const actualBaseValue = mutationExtractBaseValue(transform, baseDoc);

    expect(expectedBaseValue.isEqual(actualBaseValue!)).to.be.true;
  });

  it('increment twice', () => {
    const document = doc('collection/key', 0, { sum: 0 });

    const inc = { sum: increment(1) };
    const transform = setMutation('collection/key', inc);

    mutationApplyToLocalView(transform, document, Timestamp.now());
    mutationApplyToLocalView(transform, document, Timestamp.now());

    expect(document.isFoundDocument()).to.be.true;
    expect(document.data.field(field('sum'))).to.deep.equal(wrap(2));
  });
});
