import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileStem, guessTitleYear, parseNameDate } from './filenames.js';

test('fileStem', () => {
  assert.equal(fileStem(String.raw`M:\Sports\MLB\MLB - 2025-11-01 - A at B (World Series Game 7).mp4`), 'MLB - 2025-11-01 - A at B (World Series Game 7)');
  assert.equal(fileStem('/tv/Show Name (2005)/', true), 'Show Name (2005)');
  assert.equal(fileStem(String.raw`I:\Kids TV Shows\3Below`, true), '3Below');
});

test('parseNameDate', () => {
  assert.deepEqual(parseNameDate('MLB - 2025-11-01 - Los Angeles Dodgers at Toronto Blue Jays (World Series Game 7)'), { year: 2025, date: '2025-11-01' });
  assert.deepEqual(parseNameDate('Super Bowl 56 - 2022 - Los Angeles Rams vs. Cincinnati Bengals'), { year: 2022 });
  assert.deepEqual(parseNameDate('NHL - 2011 - Boston Bruins vs. Vancouver Canucks (Stanley Cup Final - Game 7)'), { year: 2011 });
  assert.deepEqual(parseNameDate('WWE.Raw.2024.01.15.720p.WEB'), { year: 2024, date: '2024-01-15' });
  assert.deepEqual(parseNameDate('UFC 300 - 04-13-2024 - Main Card'), { year: 2024, date: '2024-04-13' });
  assert.deepEqual(parseNameDate('Royal Rumble 1992'), { year: 1992 });
  assert.equal(parseNameDate('Game 7 1080p'), null);
  // invalid date falls back to the year
  assert.deepEqual(parseNameDate('X - 2024-13-45 - Y'), { year: 2024 });
});

test('guessTitleYear', () => {
  assert.deepEqual(guessTitleYear('Blade Runner 2049 (2017) {imdb-tt1856101}'), { title: 'Blade Runner 2049', year: 2017 });
  assert.deepEqual(guessTitleYear('The.Crucible.1996.1080p.BluRay.x264'), { title: 'The Crucible', year: 1996 });
  assert.deepEqual(guessTitleYear('2001 A Space Odyssey (1968)'), { title: '2001 A Space Odyssey', year: 1968 });
  assert.deepEqual(guessTitleYear('The Crucible'), { title: 'The Crucible', year: undefined });
  assert.deepEqual(guessTitleYear('Alien [1979] 2160p'), { title: 'Alien', year: 1979 });
  assert.deepEqual(guessTitleYear('Heat 1995 Directors Cut'), { title: 'Heat', year: 1995 });
  assert.deepEqual(guessTitleYear('3Below'), { title: '3Below', year: undefined });
  assert.deepEqual(guessTitleYear('Island, The (2005)'), { title: 'The Island', year: 2005 });
  assert.deepEqual(guessTitleYear('WALL-E.2008.REPACK.2160p.4K.BluRay.x265.10bit.AAC5.1-[YTS.MX]'), { title: 'WALL-E', year: 2008 });
});

test('planFor falls back to the folder name', async () => {
  const { planFor } = await import('./fileDates.js');
  const m = { ratingKey: '1', title: 'Attitude Era Vol. 2', year: 2026, Media: [{ Part: [{ file: String.raw`M:\Sports\Wrestling\Movies\WWE Attitude Era Vol. 2 (2014)\Attitude Era Vol. 2.mp4` }] }] };
  const p = planFor(m, { yearOnly: 'jan1', setTitle: false });
  assert.deepEqual(p.parsed, { year: 2014 });
  assert.deepEqual(p.set, { year: '2014', originallyAvailableAt: '2014-01-01' });
  const flat = { ...m, Media: [{ Part: [{ file: String.raw`M:\Sports\NHL\NHL - 2011-06-15 - Game 7.mp4` }] }] };
  assert.equal(planFor(flat, { yearOnly: 'jan1', setTitle: false }).set.originallyAvailableAt, '2011-06-15');
});
