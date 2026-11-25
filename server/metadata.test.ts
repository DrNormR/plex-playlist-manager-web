import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildEditParams } from './metadata.ts';

const current = {
  fields: { title: 'Alien', titleSort: 'Alien', year: '1979', summary: 'In space…' },
  tags: { genre: ['Horror', 'Sci-Fi'], label: [] as string[] },
  locked: ['summary'],
};

test('unchanged input sends nothing', () => {
  assert.deepEqual(buildEditParams(current, { fields: { title: 'Alien' }, tags: { genre: ['sci-fi', 'Horror'] } }), {});
});

test('changed field is sent and locked', () => {
  assert.deepEqual(buildEditParams(current, { fields: { title: 'Alien (Director’s Cut)' } }), {
    'title.value': 'Alien (Director’s Cut)',
    'title.locked': '1',
  });
});

test('lock-only change', () => {
  assert.deepEqual(buildEditParams(current, { locked: { summary: false, title: true } }), {
    'title.locked': '1',
    'summary.locked': '0',
  });
});

test('tags: adds and removes use Plex syntax', () => {
  const p = buildEditParams(current, { tags: { genre: ['Horror', 'Thriller', 'Action'], label: ['Kids, no'] } });
  assert.equal(p['genre[0].tag.tag'], 'Thriller');
  assert.equal(p['genre[1].tag.tag'], 'Action');
  assert.equal(p['genre[].tag.tag-'], 'Sci-Fi');
  assert.equal(p['genre.locked'], '1');
  assert.equal(p['label[0].tag.tag'], 'Kids, no');
});

test('removing a tag with a comma escapes it', () => {
  const p = buildEditParams({ ...current, tags: { label: ['A, B', 'C'] } }, { tags: { label: [] } });
  assert.equal(p['label[].tag.tag-'], 'A%2C%20B,C');
});

test('bad date is rejected', () => {
  assert.throws(() => buildEditParams(current, { fields: { originallyAvailableAt: '5/25/1979' } }));
});
