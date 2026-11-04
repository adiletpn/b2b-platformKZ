import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isValidGtin } from '@/lib/catalog/gtin';
import { MOCKUP_DAIRY, MOCKUP_GROCERY, PHOTO_BY_BARCODE } from '../../prisma/demo-products';

describe('товары и фото макета', () => {
  it('every_photo_file_exists', () => {
    for (const url of Object.values(PHOTO_BY_BARCODE)) {
      expect(existsSync(join(process.cwd(), 'public', url)), url).toBe(true);
    }
  });

  it('new_products_have_valid_barcode_and_photo', () => {
    for (const item of [...MOCKUP_GROCERY, ...MOCKUP_DAIRY]) {
      expect(isValidGtin(item.barcode), item.barcode).toBe(true);
      expect(PHOTO_BY_BARCODE[item.barcode], item.nameRu).toBeTruthy();
    }
  });
});
