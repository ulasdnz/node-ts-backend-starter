import i18next from 'i18next';
import { describe, expect, it } from 'vitest';
import { initI18n } from '../i18n.js';

describe('initI18n', () => {
  it('loads translations from the locales directory', async () => {
    await initI18n();

    expect(i18next.t('error.unexpected', { lng: 'en' })).toBe('An unexpected error occurred.');
    expect(i18next.t('error.unexpected', { lng: 'tr' })).toBe('Beklenmedik bir hata oluştu.');
  });
});
