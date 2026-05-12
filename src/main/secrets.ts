import { app, safeStorage } from "electron";
import { promises as fs } from "node:fs";
import { join } from "node:path";
import type { Secrets, SecretsLoadResponse } from "./types.js";

const FILE = () => join(app.getPath("userData"), "secrets.json");

type StoredShape = {
  encrypted: boolean;
  data: { url?: string; anonKey?: string; serviceKey?: string; table?: string };
};

async function readRaw(): Promise<StoredShape | null> {
  try {
    const raw = await fs.readFile(FILE(), "utf8");
    return JSON.parse(raw) as StoredShape;
  } catch {
    return null;
  }
}

async function writeRaw(payload: StoredShape): Promise<void> {
  await fs.mkdir(app.getPath("userData"), { recursive: true });
  const tmp = FILE() + ".tmp";
  await fs.writeFile(tmp, JSON.stringify(payload, null, 2), "utf8");
  await fs.rename(tmp, FILE());
}

function encrypt(value: string): string {
  if (safeStorage.isEncryptionAvailable()) {
    return safeStorage.encryptString(value).toString("base64");
  }
  return value;
}

function decrypt(value: string, encrypted: boolean): string {
  if (encrypted && safeStorage.isEncryptionAvailable()) {
    try {
      return safeStorage.decryptString(Buffer.from(value, "base64"));
    } catch {
      return "";
    }
  }
  return value;
}

export async function saveSecrets(s: Secrets): Promise<void> {
  const useEncryption = safeStorage.isEncryptionAvailable();
  const payload: StoredShape = {
    encrypted: useEncryption,
    data: {
      url: encrypt(s.url),
      anonKey: encrypt(s.anonKey),
      serviceKey: s.serviceKey ? encrypt(s.serviceKey) : undefined,
      table: encrypt(s.table),
    },
  };
  await writeRaw(payload);
}

export async function loadSecrets(): Promise<SecretsLoadResponse> {
  const encryptionAvailable = safeStorage.isEncryptionAvailable();
  const raw = await readRaw();
  if (!raw) {
    return {
      url: "",
      anonKey: "",
      table: "",
      hasServiceKey: false,
      encryptionAvailable,
    };
  }
  const decUrl = raw.data.url ? decrypt(raw.data.url, raw.encrypted) : "";
  const decAnon = raw.data.anonKey
    ? decrypt(raw.data.anonKey, raw.encrypted)
    : "";
  const decTable = raw.data.table ? decrypt(raw.data.table, raw.encrypted) : "";
  return {
    url: decUrl,
    anonKey: decAnon,
    table: decTable,
    hasServiceKey: !!raw.data.serviceKey,
    encryptionAvailable,
  };
}

export async function loadFullSecrets(): Promise<Secrets | null> {
  const raw = await readRaw();
  if (!raw) return null;
  return {
    url: raw.data.url ? decrypt(raw.data.url, raw.encrypted) : "",
    anonKey: raw.data.anonKey ? decrypt(raw.data.anonKey, raw.encrypted) : "",
    serviceKey: raw.data.serviceKey
      ? decrypt(raw.data.serviceKey, raw.encrypted)
      : undefined,
    table: raw.data.table ? decrypt(raw.data.table, raw.encrypted) : "",
  };
}

export async function clearSecrets(): Promise<void> {
  try {
    await fs.unlink(FILE());
  } catch {
    /* ignore */
  }
}
