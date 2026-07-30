// Argon2id şifre hash'leme. Not: `argon2` paketi bu ortamda native derleme
// gerektiriyor (Visual Studio Build Tools yok); işlevsel olarak eşdeğer,
// prebuilt binary ile gelen @node-rs/argon2 kullanılıyor (bkz. ADR 0006).
import { hash, verify } from "@node-rs/argon2";

export async function hashPassword(plainPassword: string): Promise<string> {
  return hash(plainPassword);
}

export async function verifyPassword(hash_: string, plainPassword: string): Promise<boolean> {
  try {
    return await verify(hash_, plainPassword);
  } catch {
    return false;
  }
}
