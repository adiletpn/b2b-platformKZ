/** Снимок данных документа: печатная форма не должна меняться вслед за каталогом. */
export type DocumentParty = {
  name: string;
  bin: string;
  legalAddress: string;
  iik: string | null;
  bik: string | null;
  bankName: string | null;
  isVatPayer: boolean;
};

export type DocumentLine = {
  position: number;
  nameRu: string;
  nameKk: string;
  unitRu: string;
  unitKk: string;
  quantity: string;
  priceWithoutVat: string;
  vatRate: string;
  vatAmount: string;
  totalWithoutVat: string;
  totalWithVat: string;
};

export type DocumentPayload = {
  number: string;
  issuedAt: string;
  orderNumber: string;
  supplier: DocumentParty;
  store: DocumentParty;
  deliveryAddress: string;
  lines: DocumentLine[];
  totalWithoutVat: string;
  vatAmount: string;
  totalWithVat: string;
  /** Только для акта расхождений. */
  discrepancies?: {
    position: number;
    nameRu: string;
    nameKk: string;
    quantityShipped: string;
    quantityAccepted: string;
    quantityDefective: string;
    quantityMismatch: string;
    amountDifference: string;
  }[];
};
