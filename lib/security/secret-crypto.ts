import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto"

const PREFIX = "cloudcode:v1:"

function primaryEncryptionSecret() {
  return process.env.CLOUDCODE_SECRET_ENCRYPTION_KEY?.trim() || null
}

function legacyEncryptionSecrets() {
  return [process.env.TRIGGER_WORKER_SECRET, process.env.CLERK_SECRET_KEY]
    .map((secret) => secret?.trim())
    .filter((secret): secret is string => Boolean(secret))
}

function allowLegacyEncryptionFallback() {
  return (
    process.env.NODE_ENV !== "production" ||
    process.env.CLOUDCODE_ALLOW_LEGACY_SECRET_DECRYPTION === "true"
  )
}

function encryptionSecrets() {
  const primary = primaryEncryptionSecret()
  const secrets = primary ? [primary] : []

  if (allowLegacyEncryptionFallback()) {
    secrets.push(...legacyEncryptionSecrets())
  }

  return secrets
}

function encryptionKey() {
  const secret = primaryEncryptionSecret() ?? encryptionSecrets()[0]

  if (!secret) {
    throw new Error(
      process.env.NODE_ENV === "production"
        ? "Set CLOUDCODE_SECRET_ENCRYPTION_KEY before saving secrets."
        : "Set CLOUDCODE_SECRET_ENCRYPTION_KEY, TRIGGER_WORKER_SECRET, or CLERK_SECRET_KEY before saving secrets in development."
    )
  }

  return createHash("sha256").update(secret).digest()
}

function isEncryptedSecret(value: string) {
  return value.startsWith(PREFIX)
}

export function encryptSecret(value: string) {
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv)
  const ciphertext = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ])
  const tag = cipher.getAuthTag()

  return [
    PREFIX,
    iv.toString("base64url"),
    ".",
    tag.toString("base64url"),
    ".",
    ciphertext.toString("base64url"),
  ].join("")
}

export function decryptSecret(value: string) {
  if (!isEncryptedSecret(value)) return value

  const [ivBase64, tagBase64, ciphertextBase64] = value
    .slice(PREFIX.length)
    .split(".")

  if (!ivBase64 || !tagBase64 || !ciphertextBase64) {
    throw new Error("Stored preset secret is malformed.")
  }

  const secrets = encryptionSecrets()
  if (secrets.length === 0) {
    throw new Error(
      process.env.NODE_ENV === "production"
        ? "Set CLOUDCODE_SECRET_ENCRYPTION_KEY before reading secrets."
        : "Set CLOUDCODE_SECRET_ENCRYPTION_KEY, TRIGGER_WORKER_SECRET, or CLERK_SECRET_KEY before reading secrets in development."
    )
  }

  const iv = Buffer.from(ivBase64, "base64url")
  const tag = Buffer.from(tagBase64, "base64url")
  const ciphertext = Buffer.from(ciphertextBase64, "base64url")

  for (const secret of secrets) {
    try {
      const decipher = createDecipheriv(
        "aes-256-gcm",
        createHash("sha256").update(secret).digest(),
        iv
      )
      decipher.setAuthTag(tag)

      return Buffer.concat([
        decipher.update(ciphertext),
        decipher.final(),
      ]).toString("utf8")
    } catch {
      // Try the next configured key. This lets us read older records that were
      // encrypted before the dedicated secret encryption key was required.
    }
  }

  throw new Error(
    "Unable to decrypt stored secret. Set the same CLOUDCODE_SECRET_ENCRYPTION_KEY in the web app and Trigger worker, or rerun the operation to generate a fresh token."
  )
}
