import { describe, expect, it } from 'vitest';
import { baseDaApi } from './configRede';

describe('baseDaApi', () => {
  it('sem URL: mesma origem (/api)', () => {
    expect(baseDaApi(undefined)).toBe('/api');
    expect(baseDaApi(null)).toBe('/api');
    expect(baseDaApi('')).toBe('/api');
    expect(baseDaApi('   ')).toBe('/api');
  });

  it('URL absoluta: acrescenta /api', () => {
    expect(baseDaApi('http://192.168.0.10:8200')).toBe('http://192.168.0.10:8200/api');
    expect(baseDaApi('https://npdev.exemplo.com.br')).toBe('https://npdev.exemplo.com.br/api');
  });

  it('tolera barra no fim e /api já informado (sem /api/api)', () => {
    expect(baseDaApi('http://x:8200/')).toBe('http://x:8200/api');
    expect(baseDaApi('http://x:8200/api')).toBe('http://x:8200/api');
    expect(baseDaApi('http://x:8200/api/')).toBe('http://x:8200/api');
    expect(baseDaApi(' http://x:8200 ')).toBe('http://x:8200/api');
  });
});
