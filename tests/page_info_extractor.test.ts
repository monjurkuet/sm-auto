import assert from 'node:assert/strict';
import test from 'node:test';

import { mergeContactInfo } from '../src/extractors/page_info_extractor';

test('mergeContactInfo keeps multiple social links from the same platform across page snapshots', () => {
  const merged = mergeContactInfo([
    {
      phones: [],
      emails: [],
      websites: [],
      addresses: [],
      socialMedia: [{ platform: 'youtube', handle: '@primarychannel', url: 'https://youtube.com/@primarychannel' }]
    },
    {
      phones: [],
      emails: [],
      websites: [],
      addresses: [],
      socialMedia: [{ platform: 'youtube', handle: '@secondarychannel', url: 'https://youtube.com/@secondarychannel' }]
    }
  ]);

  assert.deepEqual(merged.socialMedia, [
    { platform: 'youtube', handle: '@primarychannel', url: 'https://youtube.com/@primarychannel' },
    { platform: 'youtube', handle: '@secondarychannel', url: 'https://youtube.com/@secondarychannel' }
  ]);
});
