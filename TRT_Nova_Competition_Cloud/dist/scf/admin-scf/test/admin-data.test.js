import assert from 'node:assert/strict';
import test from 'node:test';
import { createDeviceService } from '../lib/deviceService.js';

test('device service builds an operational summary from device rows', async () => {
  const service = createDeviceService({
    repository: {
      listDevices: async () => [{ id: 1, name: 'balcony-pot', status: 'online' }]
    }
  });

  const result = await service.getSummary();
  assert.equal(result.total, 1);
  assert.equal(result.online, 1);
});
