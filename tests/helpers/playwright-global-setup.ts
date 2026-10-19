import { prepareTestDatabase } from './global-setup';

export default async function globalSetup() {
  await prepareTestDatabase();
}
