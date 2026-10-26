import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { homedir, platform, userInfo } from "node:os";

// ============================================================
// 全局记忆静态加密 codec（CLI 注入侧）
// ============================================================
// 与 packages/services 的 credentialCipherProvider 保持**逐字节同一线格式与密钥推导**，
// 两套进程（desktop host 设置页 / CLI 注入）才能互读同一份磁盘文件：
//   格式：enc:v1:<ivB64url>.<authTagB64url>.<cipherTextB64url>   (AES-256-GCM)
//   密钥：sha256(ZCODE_CREDENTIAL_SECRET || fallback)
//   fallback：zcode-credential-fallback:{platform}:{homedir}:{username}
// 安全边界同凭据加密：密钥可由同用户进程按公开公式推导——防文件内容被其他工具、
// 备份、批量扫描直接读走，不防同用户定向攻击。后续可升级 OS 钥匙串托管。
// ============================================================

const GLOBAL_MEMORY_ENCRYPTED_PREFIX = "enc:v1:";
const CIPHER_ALGORITHM = "aes-256-gcm";
const CIPHER_IV_BYTES = 12;
const CIPHER_AUTH_TAG_BYTES = 16;
const CREDENTIAL_SECRET_ENV_KEY = "ZCODE_CREDENTIAL_SECRET";

export interface GlobalMemoryCipher {
  encrypt(plainText: string): string;
  /** 无 enc 前缀输入原样返回（明文兼容读）；密文非法/密钥不匹配抛错。 */
  decrypt(storedText: string): string;
}

interface GlobalMemoryCipherOptions {
  env?: NodeJS.ProcessEnv;
}

function resolveSecret(env: NodeJS.ProcessEnv): string {
  const configured = env[CREDENTIAL_SECRET_ENV_KEY];
  if (configured) return configured;

  let username = "unknown";
  try {
    username = userInfo().username;
  } catch {
    // 部分运行环境拿不到系统用户，回退占位值（与 services 侧同口径）。
  }
  return `zcode-credential-fallback:${platform()}:${homedir()}:${username}`;
}

function deriveKey(secret: string): Buffer {
  return createHash("sha256").update(secret).digest();
}

export function isEncryptedMemoryFileText(raw: string): boolean {
  return raw.startsWith(GLOBAL_MEMORY_ENCRYPTED_PREFIX);
}

export function createGlobalMemoryCipher(
  options: GlobalMemoryCipherOptions = {},
): GlobalMemoryCipher {
  const env = options.env ?? process.env;
  const key = deriveKey(resolveSecret(env));

  return {
    encrypt(plainText: string): string {
      const iv = randomBytes(CIPHER_IV_BYTES);
      const cipher = createCipheriv(CIPHER_ALGORITHM, key, iv);
      const encrypted = Buffer.concat([cipher.update(plainText, "utf-8"), cipher.final()]);
      const authTag = cipher.getAuthTag();
      return [
        GLOBAL_MEMORY_ENCRYPTED_PREFIX,
        iv.toString("base64url"),
        ".",
        authTag.toString("base64url"),
        ".",
        encrypted.toString("base64url"),
      ].join("");
    },

    decrypt(storedText: string): string {
      if (!isEncryptedMemoryFileText(storedText)) {
        return storedText;
      }
      const payload = storedText.slice(GLOBAL_MEMORY_ENCRYPTED_PREFIX.length);
      const parts = payload.split(".");
      const [ivRaw, authTagRaw, cipherRaw] = parts;
      if (!ivRaw || !authTagRaw || !cipherRaw || parts.length !== 3) {
        throw new Error("Global memory ciphertext is malformed");
      }
      const iv = Buffer.from(ivRaw, "base64url");
      const authTag = Buffer.from(authTagRaw, "base64url");
      const cipherText = Buffer.from(cipherRaw, "base64url");
      if (iv.length !== CIPHER_IV_BYTES || authTag.length !== CIPHER_AUTH_TAG_BYTES) {
        throw new Error("Global memory ciphertext has invalid IV/AuthTag length");
      }
      const decipher = createDecipheriv(CIPHER_ALGORITHM, key, iv);
      decipher.setAuthTag(authTag);
      try {
        return Buffer.concat([decipher.update(cipherText), decipher.final()]).toString("utf-8");
      } catch {
        throw new Error("Global memory ciphertext cannot be decrypted (key mismatch or corrupted)");
      }
    },
  };
}
