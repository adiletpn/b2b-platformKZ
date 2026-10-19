export type FeedOffer = {
  id: string;
  barcode: string;
  nameRu: string;
  nameKk: string;
  brand: string | null;
  unitRu: string;
  unitKk: string;
  supplierId: string;
  supplierName: string;
  priceWithVat: string;
  pricePerPack: string;
  minBatch: string;
  packSize: string;
  stock: string;
  leadTimeDays: number;
  inStock: boolean;
};

export type Option = { id: string; name: string };
