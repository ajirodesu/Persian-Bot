import { getMongoDb } from '../client.js';

/**
 * Maintenance Mode — a single global "on/off" flag that restricts bot usage to
 * System Admins only (mirrors "Bot Admin Only" but at the system level).
 *
 * Stored as a single document in the systemSettings collection, upserted in
 * place. MongoDB is schemaless — no DDL required.
 */

const COLLECTION = 'systemSettings';
const KEY = 'maintenanceModeEnabled';

interface MaintenanceModeDoc {
  _id: string;
  value?: boolean;
}

export async function getMaintenanceModeEnabled(): Promise<boolean> {
  const db = getMongoDb();
  const rec = await db
    .collection<MaintenanceModeDoc>(COLLECTION)
    .findOne({ _id: KEY }, { projection: { _id: 0, value: 1 } });
  return rec?.value ?? false;
}

export async function setMaintenanceModeEnabled(enabled: boolean): Promise<void> {
  const db = getMongoDb();
  await db.collection<MaintenanceModeDoc>(COLLECTION).updateOne(
    { _id: KEY },
    {
      $set: { value: enabled, updatedAt: new Date() },
      $setOnInsert: { createdAt: new Date() },
    },
    { upsert: true },
  );
}