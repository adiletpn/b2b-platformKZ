import { binCheckDigit } from '@/lib/bin/checksum';
import { isRegistryBin } from '@/mocks/bin-registry';

/**
 * БИН с верной контрольной суммой, которого нет в мок-реестре, — так в тестах выглядит
 * настоящая компания. Номера выдуманные: май 2019, юрлицо-резидент.
 */
export function outsideRegistryBin(index: number): string {
  for (let serial = index * 10; ; serial += 1) {
    const prefix = `1905400${String(serial).padStart(4, '0')}`;
    const digit = binCheckDigit(prefix);
    const bin = `${prefix}${digit}`;
    if (digit !== null && !isRegistryBin(bin)) return bin;
  }
}
